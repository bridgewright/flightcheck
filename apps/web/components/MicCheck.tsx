"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import MicRecovery from "./MicRecovery";

import {
  DENIED_STATUS_LINES,
  classifyDeniedScope,
  normalizeMicPermissionState,
  queryMicPermission,
  recoverySteps,
  systemSettingsLink,
  type DeniedScope,
  type MicPermissionStatusLike,
} from "@/lib/mic-permission";
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
  | { kind: "denied"; scope: DeniedScope }
  | { kind: "no-device" }
  | { kind: "error"; message: string };

const STATUS_LINES: Record<
  Exclude<MicState["kind"], "live" | "error" | "denied">,
  string
> = {
  idle: "Not checked yet.",
  requesting: "Waiting for your browser's permission prompt…",
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

  // useCallback (unlike the plain functions around it) because the F-63
  // permission watch below re-runs the check from an effect, and an effect
  // dependency must hold its identity between renders.
  const start = useCallback(async () => {
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
      } else if (kind === "denied") {
        // Where the block lives decides what renders: the browser's own
        // site toggle, the operating system, or nothing at all because a
        // dismissed dialog re-asks on the next check.
        const { state: permissionState } = await queryMicPermission(
          navigator.permissions,
        );
        setState({ kind: "denied", scope: classifyDeniedScope(permissionState) });
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
  }, []);

  // F-63: while the check sits in "denied", watch the permission itself.
  // The browser's dialog exists only in the "prompt" state — once denied,
  // getUserMedia rejects instantly and no dialog will ever appear again, so
  // the customer's toggle in the browser's site settings IS the intent to
  // try again: the check re-runs on its own, and the level bar appearing
  // unasked is the product noticing. The subscription is released on
  // unmount and the moment the state leaves "denied" (same discipline as
  // the unmount cleanup above). Without navigator.permissions (older
  // Safari) the query returns no status and this effect does nothing: the
  // steps still render, only the automatic re-run is lost.
  useEffect(() => {
    if (state.kind !== "denied") return;
    let cancelled = false;
    let status: MicPermissionStatusLike | null = null;
    void queryMicPermission(navigator.permissions).then((result) => {
      if (cancelled || result.status === null) return;
      status = result.status;
      status.onchange = () => {
        if (normalizeMicPermissionState(result.status?.state) === "denied") return;
        void start();
      };
    });
    return () => {
      cancelled = true;
      if (status !== null) status.onchange = null;
    };
  }, [state.kind, start]);

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
          <p className="text-fine text-ink-muted">
            {state.deviceLabel ? `${state.deviceLabel} is live.` : "Your microphone is live."}{" "}
            Say something. The bar should move as you speak.
          </p>
          <button type="button" onClick={stopCheck} className="self-start text-fine underline underline-offset-4">
            Stop the check
          </button>
        </>
      ) : (
        <>
          <p
            className="text-fine text-ink-muted"
            role={state.kind === "denied" || state.kind === "no-device" || state.kind === "error" ? "alert" : undefined}
          >
            {state.kind === "error"
              ? state.message
              : state.kind === "denied"
                ? DENIED_STATUS_LINES[state.scope]
                : STATUS_LINES[state.kind]}
          </p>
          {state.kind === "denied" && (
            <MicRecovery
              guide={recoverySteps(navigator.userAgent)}
              scope={state.scope}
              settings={systemSettingsLink(navigator.userAgent)}
            />
          )}
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
