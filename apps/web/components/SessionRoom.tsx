"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import BrowserGate from "./BrowserGate";
import MicCheck from "./MicCheck";
import MicRecovery from "./MicRecovery";

import {
  ALARM_NOTICE,
  CARD,
  DANGER_BUTTON,
  FINE_PRINT,
  MAIN_READING,
  PAGE_HEADING,
  PRIMARY_BUTTON,
  SCORE_NUMBER,
  SECONDARY_BUTTON,
  SUB_HEADING,
} from "../lib/ui";

import {
  DENIED_STATUS_LINES,
  classifyDeniedScope,
  normalizeMicPermissionState,
  queryMicPermission,
  recoverySteps,
  systemSettingsLink,
  type DeniedScope,
  type MicPermissionStatusLike,
} from "../lib/mic-permission";
import { MAX_RECORDING_BYTES } from "../lib/realtime";
import {
  DIAG_DISCLOSURE_LABEL,
  formatDiagTrail,
  recordDiag,
  type DiagEntry,
} from "../lib/room-diagnostics";
import {
  AUDIO_RESUME_TIMEOUT_MS,
  AUDIO_START_FAILURE_MESSAGE,
  MIC_FAILURE_LINES,
  RECORDER_UNAVAILABLE_MESSAGE,
  RECORDING_DISCLOSURE,
  classifyMicFailure,
  containerType,
  pickRecorderMimeType,
  settledWithinTimeout,
  type MicFailureKind,
} from "../lib/session-media";
import {
  CONNECTION_LOST_MESSAGE,
  ECHO_OUTLIVE_MS,
  ECHO_START_WINDOW_MS,
  HARD_CUT_S,
  HEARTBEAT_INTERVAL_S,
  INITIAL_GUARD_STATE,
  INITIAL_SILENCE_STATE,
  SESSION_BUDGET_S,
  SUSPEND_GAP_S,
  committedItemId,
  closingArmedAt,
  dueTimeStatus,
  formatTimer,
  finishedTranscriptForEvent,
  greetingTriggerEvent,
  indicatorForEvent,
  interviewerStateForEvent,
  isHardCut,
  itemDeleteEvent,
  nextGuardState,
  nextSilenceState,
  responseTriggerEvent,
  silenceStatusEvent,
  speechStateForEvent,
  tickDeltaS,
  timeStatusEvent,
  unloadWarningFor,
  type GuardEndReason,
  type RoomPhase,
} from "../lib/session-room";

const OPENAI_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

// The phase list lives in lib/session-room.ts so the unload guard there can
// be exhaustive over it; adding a phase without deciding whether leaving
// during it loses work is a type error.
type Phase = RoomPhase;

interface RoomError {
  // "recorder" is the explicit state for the failure the audit found
  // vanishing at SessionRoom.tsx:338: MediaRecorder cannot be built or
  // started in this browser. It must never again present as a permanent
  // "Connecting…".
  kind: "mic" | "connect" | "upload" | "recorder";
  message: string;
  // Which mic failure this is, carried only when kind is "mic". "denied"
  // is the one the room acts on: it renders the recovery steps and arms
  // the F-63 permission watch below.
  micKind?: MicFailureKind;
  // Where a denied failure lives (browser site toggle, operating system,
  // or a dismissed dialog), captured at failure time alongside micKind.
  micScope?: DeniedScope;
}

interface SessionRoomProps {
  sessionId: string;
  reportHref: string;
}

// F-67/F-68 instrumentation: the trail the next fix will be chosen from.
// A ring buffer of turn events and start-sequence breadcrumbs, in a ref so
// recording never re-renders, surfaced behind a collapsed Diagnostics
// disclosure. Presentational only — measurement never sends anything. The
// trail is SNAPSHOTTED in the toggle handler, never read during render:
// refs are off-limits to render, and a snapshot is what the operator wants
// anyway — reopen to refresh. Collapsed, the element costs one summary row.
function DiagTrail({ entriesRef }: { entriesRef: RefObject<DiagEntry[]> }) {
  const [trail, setTrail] = useState<string | null>(null);
  const preRef = useRef<HTMLPreElement>(null);
  // Open at the END of the trail: the newest entries are where a failure
  // names itself, and the scroll box quietly hiding them cost a debugging
  // round on 2026-08-08 — two screenshots both "ended" at the fold.
  useEffect(() => {
    const pre = preRef.current;
    if (trail !== null && pre !== null) pre.scrollTop = pre.scrollHeight;
  }, [trail]);
  return (
    <details
      className="mt-6"
      onToggle={(event) =>
        setTrail(
          event.currentTarget.open
            ? formatDiagTrail(entriesRef.current)
            : null,
        )
      }
    >
      <summary className={`${FINE_PRINT} cursor-pointer`}>
        {DIAG_DISCLOSURE_LABEL}
      </summary>
      {trail !== null && (
        <pre
          ref={preRef}
          className={`${FINE_PRINT} mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap`}
        >
          {trail}
        </pre>
      )}
    </details>
  );
}

// F-12: this component holds NO credential, and no longer needs to know
// which package or slot it belongs to. All three privileged calls it makes
// -- secret mint, upload-URL mint, session complete -- send only the session
// id and authorize the signed-in viewer server-side, which is also where the
// package and index are resolved. The package access token used to arrive as
// a prop and ride in every one of those bodies: a permanent, package-wide
// capability serialized into the RSC payload for three requests that could
// derive everything they needed from the session row.

export default function SessionRoom({
  sessionId,
  reportHref,
}: SessionRoomProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("ready");
  const [error, setError] = useState<RoomError | null>(null);
  const [elapsedS, setElapsedS] = useState(0);
  const [hearing, setHearing] = useState(false);
  const [confirmingEnd, setConfirmingEnd] = useState(false);

  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  // Container of the active recording ("audio/webm" on Chrome/Edge/Firefox,
  // "audio/mp4" on Safari) — the blob and its upload Content-Type must tell
  // the truth about what was actually recorded.
  const recorderContainerRef = useRef("audio/webm");
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null); // kept for upload retries
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const startedAtRef = useRef(0);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hearingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endingRef = useRef(false);
  const connectingRef = useRef(false); // re-entry guard for start()
  const dcRef = useRef<RTCDataChannel | null>(null);
  const timeStatusSentRef = useRef(0);
  const candidateAudibleRef = useRef(false);
  const commitArrivedRef = useRef(false);
  const finishedTranscriptRef = useRef<string | null>(null);
  const morganEventAudibleRef = useRef(false);
  const diagTickRef = useRef(0);
  const lastMorganAudibleAtRef = useRef(0);
  const echoSuspectRef = useRef(false);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const micLevelDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const silenceStateRef = useRef(INITIAL_SILENCE_STATE);
  const lastTickAtRef = useRef(0);
  const remoteAnalyserRef = useRef<AnalyserNode | null>(null);
  const remoteLevelDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const heardMorganRef = useRef(false);
  const guardStateRef = useRef(INITIAL_GUARD_STATE);
  const connStateRef = useRef<string>("new");
  const messageArrivedRef = useRef(false);
  const responseRequestedRef = useRef(false);
  const responseDoneRef = useRef(false);
  const diagRef = useRef<DiagEntry[]>([]);

  // One recorder for the whole trail: monotonic clock, ring semantics in
  // the pure module, zero renders. Every breadcrumb below is a cheap push.
  const diag = useCallback((tag: string, note = "") => {
    recordDiag(diagRef.current, performance.now(), tag, note);
  }, []);

  useEffect(() => {
    if (phase !== "live") return;
    // Failures land in the diagnostic trail; a healthy beat stays silent
    // (four beats a minute would evict the turn events the ring exists to
    // keep). The 409 train was the F-66 incident's clearest signal, and
    // this used to be fire-and-forget.
    const beat = () => {
      void fetch(`/api/sessions/${sessionId}/heartbeat`, { method: "POST" })
        .then((res) => {
          if (!res.ok) diag("heartbeat-refused", String(res.status));
        })
        .catch(() => diag("heartbeat-unreachable"));
    };
    beat();
    const heartbeat = setInterval(beat, HEARTBEAT_INTERVAL_S * 1000);
    return () => clearInterval(heartbeat);
  }, [phase, diag, sessionId]);

  // --- F-63: the denied-mic error stops being a dead end ------------------
  // Once the permission is "denied", getUserMedia rejects instantly and the
  // browser will never show its dialog again, so while that error is up the
  // room watches the permission itself. The moment the customer flips the
  // toggle in site settings the error clears on its own — and ONLY the
  // error: starting an interview spends a non-repeatable session, so it
  // stays the customer's click on Start interview or Try again. Without
  // navigator.permissions (older Safari) the query returns no status and
  // this effect does nothing: the recovery steps still render, only the
  // automatic clear is lost.
  useEffect(() => {
    if (error?.kind !== "mic" || error.micKind !== "denied") return;
    let cancelled = false;
    let status: MicPermissionStatusLike | null = null;
    void queryMicPermission(navigator.permissions).then((result) => {
      if (cancelled || result.status === null) return;
      status = result.status;
      status.onchange = () => {
        if (normalizeMicPermissionState(result.status?.state) === "denied") return;
        setError(null);
      };
    });
    return () => {
      cancelled = true;
      if (status !== null) status.onchange = null;
    };
  }, [error]);

  // --- Recording teardown (awaits the final MediaRecorder chunk) --------
  const stopRecorder = useCallback(
    () =>
      new Promise<Blob>((resolve) => {
        const recorder = recorderRef.current;
        const assemble = () =>
          resolve(
            new Blob(chunksRef.current, { type: recorderContainerRef.current }),
          );
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
        // Step 1: the viewer-authorized route mints a signed upload URL.
        // Only the session id is sent: the route resolves the package and
        // the index from the authorized session row, so the storage path
        // cannot be pointed at another package's recording.
        const signRes = await fetch("/api/recordings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
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
            // The blob's own type: audio/mp4 when Safari recorded it. The
            // storage key keeps its registry-contract .webm name — the
            // scorer transcodes by sniffing content, not extensions.
            "Content-Type": blob.type !== "" ? blob.type : "audio/webm",
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
          body: JSON.stringify({ action: "complete" }),
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
    [reportHref, router, sessionId],
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

  const endForConnectionLoss = useCallback(
    async (reason: GuardEndReason) => {
      if (endingRef.current) return;
      endingRef.current = true;
      diag("guard-trip", reason);
      console.debug("[guard] trip", reason);
      if (tickerRef.current) clearInterval(tickerRef.current);
      // Stop the recorder and DISCARD the blob: audio that will never be
      // scored has no product use, and complete is never called — the
      // session row stays "planned" and the slot survives for a retry.
      await stopRecorder();
      pcRef.current?.close();
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      setPhase("connection-lost");
    },
    [diag, stopRecorder],
  );

  // --- Start: mint secret, connect WebRTC, wire the recording mix -------
  const start = useCallback(async () => {
    // Recorded BEFORE the re-entry guard: the F-68 evidence is a Start
    // click that left no trace anywhere, and a guard stuck holding
    // connectingRef would produce exactly that silence.
    diag("start-clicked", connectingRef.current ? "reentry-blocked" : "");
    // Re-entry guard (mirrors endingRef): a concurrent second start() would
    // double-mint the secret and corrupt chunksRef mid-recording.
    if (connectingRef.current) return;
    connectingRef.current = true;
    setError(null);
    setPhase("connecting");
    // The session acquires its own stream instead of reusing the MicCheck
    // one: the device check releases its stream the moment its UI is done,
    // and the session's constraints are stricter. Echo cancellation is
    // non-negotiable: without it the interviewer's own voice re-enters the
    // mic and trips server VAD mid-answer — the exact failure the webroom
    // lab harness was built to eliminate.
    let micStream = micStreamRef.current;
    let audioCtx = audioCtxRef.current;
    if (!micStream || !audioCtx) {
      try {
        // Create only what is missing: a failed attempt can null the mic
        // stream while the AudioContext survives, and Safari caps live
        // AudioContexts — recreating one per retry would strand the old
        // contexts until construction starts failing.
        if (!micStream) {
          diag("gum-begin");
          micStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
          });
          diag("gum-ok");
          micStreamRef.current = micStream;
        }
        if (!audioCtx) {
          audioCtx = new AudioContext();
          audioCtxRef.current = audioCtx;
        }
      } catch (err) {
        diag("gum-fail", err instanceof DOMException ? err.name : "unknown");
        connectingRef.current = false;
        setPhase("ready");
        // Same discrimination as MicCheck: blocked permission, missing
        // hardware, and everything else are different problems with
        // different fixes — one generic line helped nobody. For denied,
        // the permission state at failure time says WHERE the block lives,
        // and the message and recovery UI follow it.
        const kind = classifyMicFailure(
          err instanceof DOMException ? err.name : "",
        );
        if (kind === "denied") {
          const { state: permissionState } = await queryMicPermission(
            navigator.permissions,
          );
          const scope = classifyDeniedScope(permissionState);
          setError({
            kind: "mic",
            micKind: kind,
            micScope: scope,
            message: DENIED_STATUS_LINES[scope],
          });
        } else {
          setError({ kind: "mic", micKind: kind, message: MIC_FAILURE_LINES[kind] });
        }
        return;
      }
    }
    // Safari (macOS + iOS): a fresh AudioContext starts "suspended" and only
    // a resume() issued inside the user's start gesture reliably runs it —
    // without this the recording mix and the analysers are silent. The wait
    // is BOUNDED because a policy-blocked resume() never rejects — its
    // promise just stays pending (resume() only rejects on a closed
    // context), which a bare await would turn into a permanent
    // "Connecting…". Timing out lands in the honest retryable state; the
    // retry click is a fresh gesture, which resumes the same context.
    diag("resume-begin");
    const resumed = await settledWithinTimeout(
      audioCtx.resume(),
      AUDIO_RESUME_TIMEOUT_MS,
    );
    diag(resumed ? "resume-ok" : "resume-timeout");
    if (!resumed) {
      connectingRef.current = false;
      setPhase("ready");
      setError({ kind: "connect", message: AUDIO_START_FAILURE_MESSAGE });
      return;
    }
    // Unlock the remote-audio element inside the same gesture (Safari
    // autoplay policy): a play() issued now — with nothing to play yet —
    // lets the ontrack play() succeed once the interviewer's track arrives.
    void remoteAudioRef.current?.play().catch(() => {});

    // Recording mix + recorder BEFORE the secret mint: candidate mic +
    // interviewer audio into ONE stream, so the uploaded file provably
    // contains BOTH voices (the webroom lesson — a recording missing either
    // side scores half the interview). Building the recorder here means a
    // browser that cannot record fails fast into an honest state with
    // nothing minted — never mid-connection where the audit found the
    // failure vanishing (SessionRoom.tsx:338).
    const dest = audioCtx.createMediaStreamDestination();
    audioCtx.createMediaStreamSource(micStream).connect(dest);
    let recorder: MediaRecorder;
    try {
      if (typeof MediaRecorder === "undefined") {
        throw new Error("MediaRecorder is not available");
      }
      const mimeType = pickRecorderMimeType(
        typeof MediaRecorder.isTypeSupported === "function"
          ? (type) => MediaRecorder.isTypeSupported(type)
          : undefined,
      );
      if (mimeType === null) {
        throw new Error("no supported recording container");
      }
      recorder = new MediaRecorder(dest.stream, { mimeType });
      recorderContainerRef.current = containerType(mimeType);
      diag("recorder-ok", mimeType);
    } catch (err) {
      diag("recorder-fail", err instanceof Error ? err.name : "unknown");
      console.error("session room: recorder unavailable", err);
      connectingRef.current = false;
      setPhase("ready");
      setError({ kind: "recorder", message: RECORDER_UNAVAILABLE_MESSAGE });
      return;
    }
    recorderRef.current = recorder;
    try {
      const secretRes = await fetch("/api/realtime-secret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      diag("mint", String(secretRes.status));
      if (!secretRes.ok) {
        const secretBody = (await secretRes.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
        };
        // F-66: the server refuses to mint for a session that already
        // ended. This tab is stale — reload, and the server-rendered page
        // keys on the fresh status and lands on the honest ended screen.
        // Keyed on the code, never on error text, and never the
        // connection-lost story: nothing was lost, the session was simply
        // over before Start was clicked. connectingRef stays held so a
        // second click cannot race the reload.
        if (
          secretRes.status === 409 &&
          secretBody.code === "session-not-live"
        ) {
          window.location.reload();
          return;
        }
        throw new Error(
          secretBody.error ?? `secret mint failed (${secretRes.status})`,
        );
      }
      const { value: ephemeral } = (await secretRes.json()) as {
        value: string;
      };

      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      pc.onconnectionstatechange = () => {
        connStateRef.current = pc.connectionState;
        // In the trail, not just the console: the 2026-08-08 silent death
        // (dc-open, greeting-sent, then nothing) left a Diagnostics trail
        // with no transport state at all — the one thing that would have
        // named the failure.
        diag("conn-state", pc.connectionState);
        console.debug("[guard] conn-state", pc.connectionState);
      };
      pc.oniceconnectionstatechange = () => {
        diag("ice-state", pc.iceConnectionState);
      };
      pc.ontrack = (e) => {
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = e.streams[0];
          // Explicit play(): Safari does not always honor autoplay for a
          // srcObject assigned after page load, even unlocked. A rejection
          // here is non-fatal — the element was primed in the gesture.
          void remoteAudioRef.current.play().catch(() => {});
        }
        // Interviewer side of the recording mix.
        audioCtx
          .createMediaStreamSource(new MediaStream([e.track]))
          .connect(dest);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        audioCtx
          .createMediaStreamSource(new MediaStream([e.track]))
          .connect(analyser);
        remoteAnalyserRef.current = analyser;
        remoteLevelDataRef.current = new Uint8Array(
          analyser.frequencyBinCount,
        );
      };
      for (const track of micStream.getAudioTracks()) {
        pc.addTrack(track, micStream);
      }

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.addEventListener("close", () => diag("dc-close"));
      dc.addEventListener("error", () => diag("dc-error"));
      dc.addEventListener("open", () => {
        diag("dc-open");
        // The whole handler is guarded: a throw in a data-channel event
        // handler surfaces nowhere — this exact spot used to swallow
        // Safari's MediaRecorder NotSupportedError and leave the room on
        // "Connecting…" forever. Any failure now lands in the room's state
        // as an explicit recorder error.
        try {
          // Recorder starts at data-channel open — session start — so the
          // file timeline matches the interview timeline and scoring
          // timestamps (transcript start_s, observations at_s) line up.
          // Diagnostic mic level (independent of MicCheck's meter, which
          // owns its own stream and is long gone by now): lets the
          // [silence] diag line show whether a committed turn had real
          // acoustic energy behind it.
          const micAnalyser = audioCtx.createAnalyser();
          micAnalyser.fftSize = 512;
          audioCtx.createMediaStreamSource(micStream).connect(micAnalyser);
          micAnalyserRef.current = micAnalyser;
          micLevelDataRef.current = new Uint8Array(
            micAnalyser.frequencyBinCount,
          );
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
          responseRequestedRef.current = true;
          dc.send(greetingTriggerEvent());
          diag("greeting-sent");
        } catch (err) {
          diag("recorder-fail", "start");
          console.error("session room: recorder start failed", err);
          // If the recorder DID start before a later statement threw, stop
          // it — nothing may keep recording after the room tears down.
          if (recorder.state !== "inactive") recorder.stop();
          pcRef.current?.close();
          pcRef.current = null;
          micStreamRef.current?.getTracks().forEach((t) => t.stop());
          micStreamRef.current = null;
          connectingRef.current = false;
          setPhase("ready");
          setError({
            kind: "recorder",
            message: RECORDER_UNAVAILABLE_MESSAGE,
          });
        }
      });
      dc.addEventListener("message", (ev) => {
        messageArrivedRef.current = true;
        const finishedTranscript = finishedTranscriptForEvent(String(ev.data));
        if (finishedTranscript !== null) {
          finishedTranscriptRef.current = finishedTranscript;
        }
        const speech = speechStateForEvent(String(ev.data));
        if (speech !== null) console.debug("[silence] cand-ev", speech);
        if (speech === "started") {
          diag(
            morganEventAudibleRef.current ? "barge-in" : "cand-start",
          );
          candidateAudibleRef.current = true;
          // Echo physics (2026-08-01, speakers-first requirement): leaked
          // interviewer audio can only START while Morgan is (nearly)
          // audible. Episodes starting inside that window are suspect.
          echoSuspectRef.current =
            Date.now() - lastMorganAudibleAtRef.current < ECHO_START_WINDOW_MS;
        }
        if (speech === "stopped") {
          diag("cand-stop");
          candidateAudibleRef.current = false;
        }
        if (speech === "committed") {
          // A suspect episode is real speech only if it OUTLIVED Morgan's
          // audio — an echo dies with its source, a barge-in keeps going.
          // Measured at commit time, which absorbs the 900 ms VAD tail.
          const sinceMorganMs = Date.now() - lastMorganAudibleAtRef.current;
          if (!echoSuspectRef.current || sinceMorganMs >= ECHO_OUTLIVE_MS) {
            diag("commit");
            commitArrivedRef.current = true;
          } else {
            diag("commit-echo-suppressed", `${sinceMorganMs}ms`);
            console.debug("[silence] echo-suppressed", sinceMorganMs);
            const itemId = committedItemId(String(ev.data));
            if (itemId && dcRef.current?.readyState === "open") {
              // Purge the echo turn so the model never sees its own words
              // as a candidate answer.
              dcRef.current.send(itemDeleteEvent(itemId));
            }
          }
        }
        if (String(ev.data).includes('"type":"error"')) {
          diag("server-error");
          console.debug("[silence] server-error", String(ev.data).slice(0, 300));
        }
        // Truncation visibility: if these ever reappear, Morgan's audio is
        // being cut server-side again (interrupt_response must stay false).
        if (String(ev.data).includes("output_audio_buffer.cleared")) {
          console.debug("[silence] morgan-audio-cleared");
        }
        if (String(ev.data).includes('"conversation.item.truncated"')) {
          console.debug("[silence] morgan-item-truncated");
        }
        // Morgan's audio lifecycle from server events — the analyser is the
        // fallback, not the sole source; response_done also opens the
        // clock's activation gate.
        const morgan = interviewerStateForEvent(String(ev.data));
        if (morgan !== null) console.debug("[silence] morgan-ev", morgan);
        if (morgan === "speaking") {
          diag("morgan-speaking");
          morganEventAudibleRef.current = true;
          heardMorganRef.current = true;
        }
        if (morgan === "quiet") {
          diag("morgan-quiet");
          morganEventAudibleRef.current = false;
        }
        if (morgan === "response_done") {
          diag("response-done");
          responseDoneRef.current = true;
          heardMorganRef.current = true;
        }
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
      diag("sdp", String(sdpRes.status));
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
  }, [diag, sessionId]);

  // --- Timer + 25:00 hard cut -------------------------------------------
  useEffect(() => {
    if (phase !== "live") return;
    lastTickAtRef.current = performance.now();
    tickerRef.current = setInterval(() => {
      // Real tick length, never the nominal 250 ms: a throttled tab hands
      // back its parked time as one very late callback or a queued burst,
      // and only a monotonic delta lets the clock tell either apart from
      // silence the candidate actually sat through.
      const tickAt = performance.now();
      const dtS = tickDeltaS(tickAt, lastTickAtRef.current);
      lastTickAtRef.current = tickAt;
      const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setElapsedS(elapsed);
      const due = dueTimeStatus(elapsed, timeStatusSentRef.current);
      if (due && dcRef.current?.readyState === "open") {
        dcRef.current.send(timeStatusEvent(due.text));
        timeStatusSentRef.current += 1;
      }
      let interviewerAudible = false;
      let remotePeak = 0;
      const analyser = remoteAnalyserRef.current;
      const data = remoteLevelDataRef.current;
      if (analyser && data) {
        analyser.getByteTimeDomainData(data);
        for (const v of data) {
          remotePeak = Math.max(remotePeak, Math.abs(v - 128) / 128);
        }
        interviewerAudible = remotePeak > 0.02;
        if (interviewerAudible) heardMorganRef.current = true;
      }
      let micPeak = 0;
      const micAnalyser = micAnalyserRef.current;
      const micData = micLevelDataRef.current;
      if (micAnalyser && micData) {
        micAnalyser.getByteTimeDomainData(micData);
        for (const v of micData) {
          micPeak = Math.max(micPeak, Math.abs(v - 128) / 128);
        }
      }
      // Server events are the second source: whichever signal works on this
      // transport keeps the clock honest (2026-08-01 live failure).
      interviewerAudible = interviewerAudible || morganEventAudibleRef.current;
      if (interviewerAudible) lastMorganAudibleAtRef.current = Date.now();
      diagTickRef.current = (diagTickRef.current + 1) % 8;
      if (diagTickRef.current === 0) {
        console.debug(
          "[silence] diag",
          JSON.stringify({
            peak: Number(remotePeak.toFixed(3)),
            mic: Number(micPeak.toFixed(3)),
            evAudible: morganEventAudibleRef.current,
            gate: heardMorganRef.current,
            cand: candidateAudibleRef.current,
            quietS: Number(silenceStateRef.current.quietS.toFixed(1)),
            stages: silenceStateRef.current.stagesSent,
          }),
        );
      }
      if (heardMorganRef.current && dcRef.current?.readyState === "open") {
        const commitArrived = commitArrivedRef.current;
        commitArrivedRef.current = false;
        if (dtS >= SUSPEND_GAP_S) {
          console.debug("[silence] suspend-resume", Number(dtS.toFixed(1)));
        }
        const beforeClosing = silenceStateRef.current.closingSeen;
        const { state, effects } = nextSilenceState(silenceStateRef.current, {
          dtS,
          candidateAudible: candidateAudibleRef.current,
          interviewerAudible,
          commitArrived,
          elapsedS: elapsed,
          finishedTranscript: finishedTranscriptRef.current,
        });
        finishedTranscriptRef.current = null;
        silenceStateRef.current = state;
        if (!beforeClosing && state.closingSeen) {
          const fromWrapUpS = elapsed - closingArmedAt(SESSION_BUDGET_S);
          diag("closing-detected", `${fromWrapUpS >= 0 ? "+" : ""}${fromWrapUpS}s vs wrap-up`);
        }
        if (!due) {
          if (effects.stage) {
            diag("response-trigger", "stage");
            console.debug("[silence] stage fired", effects.stage.at);
            dcRef.current.send(silenceStatusEvent(effects.stage.text));
            responseRequestedRef.current = true;
            dcRef.current.send(responseTriggerEvent());
          } else if (effects.triggerResponse) {
            diag("response-trigger", "debounce");
            console.debug("[silence] response trigger");
            responseRequestedRef.current = true;
            dcRef.current.send(responseTriggerEvent());
          }
        }
        if (effects.endInterview) {
          diag("auto-end", "interview-complete");
          void endSession();
        }
      }
      const messageArrived = messageArrivedRef.current;
      messageArrivedRef.current = false;
      const responseRequested = responseRequestedRef.current;
      responseRequestedRef.current = false;
      const responseDone = responseDoneRef.current;
      responseDoneRef.current = false;
      const guard = nextGuardState(guardStateRef.current, {
        dtS,
        connectionState: connStateRef.current,
        dcOpen: dcRef.current?.readyState === "open",
        messageArrived,
        responseRequested,
        responseDone,
        candidateAudible: candidateAudibleRef.current,
        interviewerAudible,
      });
      guardStateRef.current = guard.state;
      if (guard.endReason !== null) {
        void endForConnectionLoss(guard.endReason);
        return;
      }
      if (isHardCut(elapsed)) {
        void endSession(); // auto End; endSession guards re-entry
      }
    }, 250);
    return () => {
      if (tickerRef.current) clearInterval(tickerRef.current);
    };
  }, [phase, diag, endSession, endForConnectionLoss]);

  // --- F-38: don't let a tab close throw away an interview ---------------
  // The recording lives only in this tab until the upload lands, and the
  // upload retry button is useless to someone who has already closed the
  // page. The browser's own confirmation dialog is the only thing that can
  // interrupt a close, so arm it for exactly the phases that hold work the
  // server does not have yet.
  useEffect(() => {
    const warning = unloadWarningFor(phase);
    if (warning === null) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      // preventDefault is the modern signal; a non-empty returnValue is
      // what still arms the dialog in Safari and older Chrome. Browsers
      // show their own wording — the string is the intent, and the tests
      // pin which phases carry one.
      event.preventDefault();
      event.returnValue = warning;
      return warning;
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [phase]);

  // --- Unmount cleanup ---------------------------------------------------
  useEffect(
    () => () => {
      if (hearingTimeoutRef.current) clearTimeout(hearingTimeoutRef.current);
      pcRef.current?.close();
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      void audioCtxRef.current?.close();
    },
    [],
  );

  return (
    // The same column the rest of the product uses, and the same gutters.
    //
    // This was `mx-auto max-w-2xl p-8`, a literal from before the design pass
    // set Shell's widths. The room renders chrome-less on purpose, so it never
    // passed through Shell and was missed when everything else moved onto the
    // container tokens: at 1422px the interview opened in a 588px column with
    // 445px of blank on either side, which reads as a page that failed to load
    // rather than as focus.
    //
    // `min-h-dvh` plus `flex-col` so the pre-connect block below can take
    // `my-auto` and sit in the middle of the screen. dvh rather than vh
    // because a phone's address bar makes vh lie.
    <main className={`${MAIN_READING} flex min-h-dvh flex-col`}>
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {phase === "ready" && (
        // Centred: this is one short block on an otherwise empty screen, and
        // pinned to the top it left two thirds of the viewport blank under it.
        // Only this phase. Once the interview is live the transcript grows
        // downward and has to start at the top.
        <section className="my-auto">
          <h1 className={PAGE_HEADING}>Interview session</h1>
          <p className="mt-2 text-fine text-ink-faint">
            Headphones are strongly recommended: they keep the
            interviewer&apos;s voice out of your microphone, so your turns
            are detected cleanly.
          </p>
          {/* Capability gate BEFORE the mic check: a browser missing
              getUserMedia, WebRTC, or MediaRecorder gets honest copy naming
              supported browsers instead of a check that cannot succeed. */}
          <BrowserGate>
            {/* Device check (shared MicCheck): confirm the mic picks you up
                before committing to a 20-minute session. It holds its own
                stream; the session acquires its own in start(). */}
            <div className={`${CARD} mt-6 p-4`}>
              <h2 className={SUB_HEADING}>Microphone check</h2>
              <div className="mt-3">
                <MicCheck />
              </div>
              <p className="mt-3 text-fine text-ink-faint">
                {RECORDING_DISCLOSURE}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void start()}
              className={`${PRIMARY_BUTTON} mt-6`}
            >
              Start interview
            </button>
            {error && error.kind !== "upload" && (
              <div className={`${ALARM_NOTICE} mt-6`}>
                <p className={SUB_HEADING}>
                  {error.kind === "mic"
                    ? "Microphone unavailable"
                    : error.kind === "recorder"
                      ? "Recording is not available in this browser"
                      : "Could not start the interview"}
                </p>
                <p className="mt-1 text-fine">{error.message}</p>
                {error.kind === "mic" && error.micKind === "denied" && (
                  <div className="mt-3">
                    <MicRecovery
                      guide={recoverySteps(navigator.userAgent)}
                      scope={error.micScope ?? "unknown"}
                      settings={systemSettingsLink(navigator.userAgent)}
                    />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => void start()}
                  className={`${SECONDARY_BUTTON} mt-3`}
                >
                  Try again
                </button>
                <DiagTrail entriesRef={diagRef} />
              </div>
            )}
          </BrowserGate>
        </section>
      )}

      {phase === "connecting" && (
        <p className="text-ink-faint">
          Connecting to your interviewer… Morgan speaks first, so there is no
          need to say hello.
        </p>
      )}

      {phase === "live" && (
        <section>
          <div className={`${CARD} flex items-baseline gap-4 p-4`}>
            <span className={`${SCORE_NUMBER} text-page`}>
              {formatTimer(elapsedS)}
            </span>
            <span className="text-fine text-ink-faint">
              / {formatTimer(SESSION_BUDGET_S)} planned · hard stop at{" "}
              {formatTimer(HARD_CUT_S)}
            </span>
            <span
              className={`ml-auto text-fine ${
                hearing ? "text-ready" : "text-transparent"
              }`}
            >
              ● hearing you
            </span>
          </div>
          {elapsedS < 15 && (
            <p className="mt-2 text-fine text-ink-faint">
              Morgan will greet you in a moment, so you don&apos;t need to
              speak first.
            </p>
          )}
          {!confirmingEnd && (
            <button
              type="button"
              onClick={() => setConfirmingEnd(true)}
              className={`${SECONDARY_BUTTON} mt-6`}
            >
              End interview
            </button>
          )}
          {confirmingEnd && (
            <div className={`${CARD} mt-6 p-4`}>
              <p>End the interview and send it for scoring?</p>
              <div className="mt-3 flex gap-3">
                <button
                  type="button"
                  onClick={() => void endSession()}
                  className={DANGER_BUTTON}
                >
                  Yes, end now
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingEnd(false)}
                  className={SECONDARY_BUTTON}
                >
                  Keep going
                </button>
              </div>
            </div>
          )}
          <DiagTrail entriesRef={diagRef} />
        </section>
      )}

      {phase === "uploading" && !error && (
        <p className="text-ink-faint">
          Saving your recording and starting the scoring run…
        </p>
      )}
      {phase === "uploading" && error?.kind === "upload" && (
        <div className={ALARM_NOTICE}>
          <p className={SUB_HEADING}>
            Your recording is safe in this tab, but saving it failed
          </p>
          <p className="mt-1 text-fine">{error.message}</p>
          <p className="mt-1 text-fine text-ink-faint">
            Do not close this tab. Retry until the upload succeeds.
          </p>
          <button
            type="button"
            onClick={() => {
              if (blobRef.current) void uploadAndComplete(blobRef.current);
            }}
            className={`${PRIMARY_BUTTON} mt-3`}
          >
            Retry upload
          </button>
          <DiagTrail entriesRef={diagRef} />
        </div>
      )}

      {phase === "done" && (
        <p className="text-ink-faint">
          Recording saved. Opening your report…
        </p>
      )}

      {phase === "connection-lost" && (
        <section>
          <h1 className={PAGE_HEADING}>Connection lost</h1>
          <p className="mt-3 text-fine text-ink-muted">
            {CONNECTION_LOST_MESSAGE}
          </p>
          <button
            type="button"
            className={`${PRIMARY_BUTTON} mt-6`}
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
          <DiagTrail entriesRef={diagRef} />
        </section>
      )}
    </main>
  );
}
