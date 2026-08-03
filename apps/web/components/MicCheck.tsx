"use client";

import { useEffect, useRef, useState } from "react";

import { classifyMicFailure } from "@/lib/session-media";
import { PRIMARY_BUTTON } from "@/lib/ui";

// A small, honest microphone check: ask for permission, show a live input
// level, and say plainly what is wrong when nothing works. Shared between
// Settings and the session-room pre-connect step. Browser APIs only — no
// audio libraries.

type MicState =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "live"; deviceLabel: string | null }
  | { kind: "denied" }
  | { kind: "no-device" }
  | { kind: "error"; message: string };

const STATUS_LINES: Record<Exclude<MicState["kind"], "live" | "error">, string> = {
  idle: "Not checked yet.",
  requesting: "Waiting for your browser's permission prompt…",
  denied:
    "Microphone access is blocked. Allow it for this site in your browser settings, then check again.",
  "no-device":
    "No microphone was found. Connect one, or pick a different input device in your system settings, then check again.",
};

export default function MicCheck() {
  const [state, setState] = useState<MicState>({ kind: "idle" });
  const [level, setLevel] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  function stop() {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void contextRef.current?.close().catch(() => {});
    contextRef.current = null;
    setLevel(0);
  }

  // Release the microphone the moment the component unmounts — a page must
  // never keep the mic-in-use indicator on after its check UI is gone. The
  // cleanup reads refs directly (they are stable) instead of closing over
  // stop(), whose identity changes every render.
  useEffect(() => {
    const raf = rafRef;
    const stream = streamRef;
    const context = contextRef;
    return () => {
      if (raf.current !== null) {
        cancelAnimationFrame(raf.current);
      }
      stream.current?.getTracks().forEach((track) => track.stop());
      void context.current?.close().catch(() => {});
    };
  }, []);

  async function start() {
    setState({ kind: "requesting" });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      // Shared classification (lib/session-media) so this check and the
      // session room discriminate failures identically; the copy stays
      // MicCheck's own ("check again" — this is a check, not the interview).
      const kind = classifyMicFailure(err instanceof DOMException ? err.name : "");
      if (kind === "other") {
        setState({
          kind: "error",
          message: "The microphone could not be started. Reload the page and try again.",
        });
      } else {
        setState({ kind });
      }
      return;
    }

    streamRef.current = stream;
    const context = new AudioContext();
    contextRef.current = context;
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);

    const tick = () => {
      analyser.getByteTimeDomainData(samples);
      let sumSquares = 0;
      for (const sample of samples) {
        const centered = (sample - 128) / 128;
        sumSquares += centered * centered;
      }
      // RMS of normal speech is well under full scale; the multiplier maps a
      // conversational level to most of the bar without lying about clipping.
      setLevel(Math.min(1, Math.sqrt(sumSquares / samples.length) * 4));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    setState({
      kind: "live",
      deviceLabel: stream.getAudioTracks()[0]?.label || null,
    });
  }

  function stopCheck() {
    stop();
    setState({ kind: "idle" });
  }

  return (
    <div className="flex flex-col gap-3">
      {state.kind === "live" ? (
        <>
          <div
            role="meter"
            aria-label="Microphone input level"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(level * 100)}
            className="h-2 w-full overflow-hidden rounded-full bg-hairline"
          >
            <div
              className="h-full bg-ink transition-[width] duration-75"
              style={{ width: `${Math.round(level * 100)}%` }}
            />
          </div>
          <p className="text-sm text-ink-muted">
            {state.deviceLabel ? `${state.deviceLabel} is live.` : "Your microphone is live."}{" "}
            Say something. The bar should move as you speak.
          </p>
          <button type="button" onClick={stopCheck} className="self-start text-sm underline underline-offset-4">
            Stop the check
          </button>
        </>
      ) : (
        <>
          <p
            className="text-sm text-ink-muted"
            role={state.kind === "denied" || state.kind === "no-device" || state.kind === "error" ? "alert" : undefined}
          >
            {state.kind === "error" ? state.message : STATUS_LINES[state.kind]}
          </p>
          <button
            type="button"
            onClick={start}
            disabled={state.kind === "requesting"}
            className={`${PRIMARY_BUTTON} self-start`}
          >
            {state.kind === "requesting"
              ? "Waiting for permission…"
              : state.kind === "idle"
                ? "Check my microphone"
                : "Check again"}
          </button>
        </>
      )}
    </div>
  );
}
