"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { MAX_RECORDING_BYTES } from "../lib/realtime";
import {
  HARD_CUT_S,
  SESSION_BUDGET_S,
  dueTimeStatus,
  formatTimer,
  greetingTriggerEvent,
  indicatorForEvent,
  isHardCut,
  timeStatusEvent,
} from "../lib/session-room";

const OPENAI_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

type Phase = "ready" | "connecting" | "live" | "uploading" | "done";

interface RoomError {
  kind: "mic" | "connect" | "upload";
  message: string;
}

interface SessionRoomProps {
  sessionId: string;
  packageId: string;
  sessionIndex: number;
  /** Package access token — the v0.1 credential every privileged call carries. */
  token: string;
  reportHref: string;
}

export default function SessionRoom({
  sessionId,
  packageId,
  sessionIndex,
  token,
  reportHref,
}: SessionRoomProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("ready");
  const [error, setError] = useState<RoomError | null>(null);
  const [micReady, setMicReady] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [elapsedS, setElapsedS] = useState(0);
  const [hearing, setHearing] = useState(false);
  const [confirmingEnd, setConfirmingEnd] = useState(false);

  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null); // kept for upload retries
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const startedAtRef = useRef(0);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hearingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const meterRafRef = useRef(0);
  const endingRef = useRef(false);
  const connectingRef = useRef(false); // re-entry guard for start()
  const dcRef = useRef<RTCDataChannel | null>(null);
  const timeStatusSentRef = useRef(0);

  // --- Ready screen: mic check ------------------------------------------
  const enableMic = useCallback(async () => {
    setError(null);
    try {
      // Echo cancellation is non-negotiable: without it the interviewer's
      // own voice re-enters the mic and trips server VAD mid-answer — the
      // exact failure the webroom lab harness was built to eliminate.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      micStreamRef.current = stream;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      // Level meter: the candidate sees the mic actually picking them up
      // before committing to a 20-minute session.
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) {
          peak = Math.max(peak, Math.abs(v - 128) / 128);
        }
        setMicLevel(peak);
        meterRafRef.current = requestAnimationFrame(loop);
      };
      meterRafRef.current = requestAnimationFrame(loop);
      setMicReady(true);
    } catch {
      setError({
        kind: "mic",
        message:
          "Microphone access was denied or failed. The interview cannot " +
          "run without a microphone — allow access in the browser prompt " +
          "(or the address-bar site settings) and try again.",
      });
    }
  }, []);

  // --- Recording teardown (awaits the final MediaRecorder chunk) --------
  const stopRecorder = useCallback(
    () =>
      new Promise<Blob>((resolve) => {
        const recorder = recorderRef.current;
        const assemble = () =>
          resolve(new Blob(chunksRef.current, { type: "audio/webm" }));
        if (!recorder || recorder.state === "inactive") {
          assemble();
          return;
        }
        recorder.onstop = assemble;
        recorder.stop();
      }),
    [],
  );

  // --- Upload + complete (retryable on its own: the interview is over
  // and cannot be redone, so a failure here must never lose the blob) ----
  const uploadAndComplete = useCallback(
    async (blob: Blob) => {
      setPhase("uploading");
      setError(null);
      try {
        // Size gate stays client-side: the blob no longer passes through a
        // web route (see below), so this is where the 50 MB cap lives.
        if (blob.size > MAX_RECORDING_BYTES) {
          throw new Error("recording exceeds the 50 MB upload limit");
        }
        // Step 1: the token-authorized route mints a signed upload URL for
        // the server-derived storage path.
        const signRes = await fetch("/api/recordings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ packageId, sessionIndex, token }),
        });
        if (!signRes.ok) {
          const signBody = (await signRes.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(
            signBody.error ?? `upload authorization failed (${signRes.status})`,
          );
        }
        const { signedUrl } = (await signRes.json()) as { signedUrl: string };
        // Step 2: PUT the blob straight to Supabase Storage (the
        // supabase-js uploadToSignedUrl contract: PUT to the signed URL,
        // x-upsert matching the minted-with-upsert token). The recording
        // never transits a Vercel function, whose ~4.5 MB body limit a real
        // 20-minute recording exceeds.
        const upRes = await fetch(signedUrl, {
          method: "PUT",
          headers: {
            "Content-Type": "audio/webm",
            "x-upsert": "true",
          },
          body: blob,
        });
        if (!upRes.ok) {
          throw new Error(`recording upload failed (${upRes.status})`);
        }
        // No audio_path in the body: the server derives the storage path
        // from the authorized session row, so the client cannot point the
        // scorer at another package's recording.
        const completeRes = await fetch(`/api/sessions/${sessionId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "complete", token }),
        });
        // 409 = the worker already has this session scoring (or scored) —
        // e.g. a retry after a lost response. The run we wanted exists, the
        // recording is uploaded: proceed to the report, do not error.
        if (!completeRes.ok && completeRes.status !== 409) {
          const completeBody = (await completeRes
            .json()
            .catch(() => ({}))) as { error?: string };
          throw new Error(
            completeBody.error ??
              `session complete failed (${completeRes.status})`,
          );
        }
        setPhase("done");
        router.push(reportHref);
      } catch (err) {
        setError({
          kind: "upload",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [packageId, reportHref, router, sessionId, sessionIndex, token],
  );

  const endSession = useCallback(async () => {
    if (endingRef.current) return;
    endingRef.current = true;
    setConfirmingEnd(false);
    if (tickerRef.current) clearInterval(tickerRef.current);
    const blob = await stopRecorder();
    blobRef.current = blob;
    pcRef.current?.close();
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    await uploadAndComplete(blob);
  }, [stopRecorder, uploadAndComplete]);

  // --- Start: mint secret, connect WebRTC, wire the recording mix -------
  const start = useCallback(async () => {
    // Re-entry guard (mirrors endingRef): a concurrent second start() would
    // double-mint the secret and corrupt chunksRef mid-recording.
    if (connectingRef.current) return;
    connectingRef.current = true;
    const micStream = micStreamRef.current;
    const audioCtx = audioCtxRef.current;
    if (!micStream || !audioCtx) {
      connectingRef.current = false;
      return;
    }
    setError(null);
    setPhase("connecting");
    try {
      const secretRes = await fetch("/api/realtime-secret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, token }),
      });
      if (!secretRes.ok) {
        const secretBody = (await secretRes.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          secretBody.error ?? `secret mint failed (${secretRes.status})`,
        );
      }
      const { value: ephemeral } = (await secretRes.json()) as {
        value: string;
      };

      // Recording mix: candidate mic + interviewer audio into ONE stream,
      // so the uploaded file provably contains BOTH voices (the webroom
      // lesson — a recording missing either side scores half the interview).
      const dest = audioCtx.createMediaStreamDestination();
      audioCtx.createMediaStreamSource(micStream).connect(dest);

      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      pc.ontrack = (e) => {
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = e.streams[0];
        }
        // Interviewer side of the recording mix.
        audioCtx
          .createMediaStreamSource(new MediaStream([e.track]))
          .connect(dest);
      };
      for (const track of micStream.getAudioTracks()) {
        pc.addTrack(track, micStream);
      }

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.addEventListener("open", () => {
        // The mic-check level meter is gone from the UI once the room is
        // live: stop its rAF loop instead of re-rendering ~60fps for the
        // whole interview (it would also outlive the mic tracks).
        if (meterRafRef.current) {
          cancelAnimationFrame(meterRafRef.current);
          meterRafRef.current = 0;
        }
        // Recorder starts at data-channel open — session start — so the
        // file timeline matches the interview timeline and scoring
        // timestamps (transcript start_s, observations at_s) line up.
        const recorder = new MediaRecorder(dest.stream, {
          mimeType: "audio/webm;codecs=opus",
        });
        recorderRef.current = recorder;
        chunksRef.current = [];
        recorder.ondataavailable = (ev) => {
          if (ev.data.size > 0) chunksRef.current.push(ev.data);
        };
        recorder.start(1000); // 1s timeslice: a crash loses <= 1s of audio
        startedAtRef.current = Date.now();
        setPhase("live");
        // Server-VAD models never speak unprompted: nudge the first
        // response so Morgan opens the session (the recorder is already
        // rolling, so the greeting lands in the recording).
        dc.send(greetingTriggerEvent());
      });
      dc.addEventListener("message", (ev) => {
        if (indicatorForEvent(String(ev.data)) === "listening") {
          setHearing(true);
          if (hearingTimeoutRef.current) {
            clearTimeout(hearingTimeoutRef.current);
          }
          hearingTimeoutRef.current = setTimeout(
            () => setHearing(false),
            2000,
          );
        }
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      // GA fact: NO ?model= query param here — the model rides on the
      // minted secret, not the URL.
      const sdpRes = await fetch(OPENAI_CALLS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ephemeral}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      });
      if (!sdpRes.ok) {
        throw new Error(
          `SDP exchange failed (${sdpRes.status}): ${await sdpRes.text()}`,
        );
      }
      await pc.setRemoteDescription({
        type: "answer",
        sdp: await sdpRes.text(),
      });
    } catch (err) {
      pcRef.current?.close();
      pcRef.current = null;
      connectingRef.current = false; // allow "Try again"
      setPhase("ready");
      setError({
        kind: "connect",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [sessionId, token]);

  // --- Timer + 25:00 hard cut -------------------------------------------
  useEffect(() => {
    if (phase !== "live") return;
    tickerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setElapsedS(elapsed);
      const due = dueTimeStatus(elapsed, timeStatusSentRef.current);
      if (due && dcRef.current?.readyState === "open") {
        dcRef.current.send(timeStatusEvent(due.text));
        timeStatusSentRef.current += 1;
      }
      if (isHardCut(elapsed)) {
        void endSession(); // auto End; endSession guards re-entry
      }
    }, 250);
    return () => {
      if (tickerRef.current) clearInterval(tickerRef.current);
    };
  }, [phase, endSession]);

  // --- Unmount cleanup ---------------------------------------------------
  useEffect(
    () => () => {
      if (meterRafRef.current) cancelAnimationFrame(meterRafRef.current);
      if (hearingTimeoutRef.current) clearTimeout(hearingTimeoutRef.current);
      pcRef.current?.close();
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      void audioCtxRef.current?.close();
    },
    [],
  );

  return (
    <main className="mx-auto max-w-2xl p-8">
      <audio ref={remoteAudioRef} autoPlay />

      {phase === "ready" && (
        <section>
          <h1 className="text-xl font-semibold">Interview session</h1>
          <p className="mt-2 text-sm text-neutral-500">
            Headphones are strongly recommended: they keep the
            interviewer&apos;s voice out of your microphone, so your turns
            are detected cleanly.
          </p>
          {!micReady && (
            <button
              type="button"
              onClick={() => void enableMic()}
              className="mt-6 rounded-lg border border-current px-5 py-3"
            >
              Enable microphone
            </button>
          )}
          {micReady && (
            <div className="mt-6">
              <div className="h-2 w-full rounded bg-neutral-200 dark:bg-neutral-800">
                <div
                  className="h-2 rounded bg-green-600 transition-[width] duration-75"
                  style={{ width: `${Math.min(100, micLevel * 100)}%` }}
                />
              </div>
              <p className="mt-2 text-sm text-neutral-500">
                Say a few words — the bar should move. When it does, you are
                ready.
              </p>
              <button
                type="button"
                onClick={() => void start()}
                className="mt-6 rounded-lg border border-current px-5 py-3"
              >
                Start interview
              </button>
            </div>
          )}
          {error && (error.kind === "mic" || error.kind === "connect") && (
            <div className="mt-6 rounded-lg border border-red-600 p-4">
              <p className="font-medium text-red-600">
                {error.kind === "mic"
                  ? "Microphone unavailable"
                  : "Could not start the interview"}
              </p>
              <p className="mt-1 text-sm">{error.message}</p>
              <button
                type="button"
                onClick={() =>
                  error.kind === "mic" ? void enableMic() : void start()
                }
                className="mt-3 rounded-lg border border-current px-4 py-2"
              >
                Try again
              </button>
            </div>
          )}
        </section>
      )}

      {phase === "connecting" && (
        <p className="text-neutral-500">
          Connecting to your interviewer… Morgan speaks first — no need to
          say hello.
        </p>
      )}

      {phase === "live" && (
        <section>
          <div className="flex items-baseline gap-4 rounded-lg border border-neutral-300 p-4 dark:border-neutral-700">
            <span className="text-2xl tabular-nums">
              {formatTimer(elapsedS)}
            </span>
            <span className="text-sm text-neutral-500">
              / {formatTimer(SESSION_BUDGET_S)} planned · hard stop at{" "}
              {formatTimer(HARD_CUT_S)}
            </span>
            <span
              className={`ml-auto text-sm ${
                hearing ? "text-green-600" : "text-transparent"
              }`}
            >
              ● hearing you
            </span>
          </div>
          {elapsedS < 15 && (
            <p className="mt-2 text-sm text-neutral-500">
              Morgan will greet you in a moment — you don&apos;t need to
              speak first.
            </p>
          )}
          {!confirmingEnd && (
            <button
              type="button"
              onClick={() => setConfirmingEnd(true)}
              className="mt-6 rounded-lg border border-current px-5 py-3"
            >
              End interview
            </button>
          )}
          {confirmingEnd && (
            <div className="mt-6 rounded-lg border border-neutral-300 p-4 dark:border-neutral-700">
              <p>End the interview and send it for scoring?</p>
              <div className="mt-3 flex gap-3">
                <button
                  type="button"
                  onClick={() => void endSession()}
                  className="rounded-lg border border-current px-4 py-2"
                >
                  Yes, end now
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingEnd(false)}
                  className="rounded-lg border border-neutral-400 px-4 py-2 text-neutral-500"
                >
                  Keep going
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {phase === "uploading" && !error && (
        <p className="text-neutral-500">
          Saving your recording and starting the scoring run…
        </p>
      )}
      {phase === "uploading" && error?.kind === "upload" && (
        <div className="rounded-lg border border-red-600 p-4">
          <p className="font-medium text-red-600">
            Your recording is safe in this tab, but saving it failed
          </p>
          <p className="mt-1 text-sm">{error.message}</p>
          <p className="mt-1 text-sm text-neutral-500">
            Do not close this tab — retry until the upload succeeds.
          </p>
          <button
            type="button"
            onClick={() => {
              if (blobRef.current) void uploadAndComplete(blobRef.current);
            }}
            className="mt-3 rounded-lg border border-current px-4 py-2"
          >
            Retry upload
          </button>
        </div>
      )}

      {phase === "done" && (
        <p className="text-neutral-500">
          Recording saved. Opening your report…
        </p>
      )}
    </main>
  );
}
