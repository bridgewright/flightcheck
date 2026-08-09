"use client";

import { useSyncExternalStore, type ReactNode } from "react";

import {
  IN_APP_BROWSER_HINT,
  SUPPORTED_BROWSERS_LINE,
  missingCapabilities,
  unsupportedBrowserMessage,
} from "@/lib/session-media";
import { NOTICE, SUB_HEADING } from "@/lib/ui";

// Capability gate for the interview room: probes the three browser APIs a
// live session cannot run without, and when any is missing replaces its
// children with honest copy BEFORE the user invests in a mic check.
//
// The probe rides useSyncExternalStore as a client-only static value: the
// server snapshot (null) renders the children, and the first client render
// swaps in the real probe without a hydration mismatch. Capabilities cannot
// change within a page's life, so the result is computed once and cached —
// the store never notifies.

const subscribe = () => () => {};

const probed: Record<"withRecorder" | "withoutRecorder", string[] | null> = {
  withRecorder: null,
  withoutRecorder: null,
};

function probe(requireRecorder: boolean): string[] {
  const key = requireRecorder ? "withRecorder" : "withoutRecorder";
  probed[key] ??= missingCapabilities({
    hasGetUserMedia:
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getUserMedia === "function",
    hasRTCPeerConnection: typeof RTCPeerConnection !== "undefined",
    // An unscored quick interview records nothing, so a browser without
    // MediaRecorder can run it. Microphone access and a real-time audio
    // connection are needed either way, and a browser missing those must
    // still get the honest copy rather than a mic check that cannot pass —
    // the quick interview is the front door, and in-app browsers (the ones
    // most likely to lack these) are exactly what a landing CTA sends here.
    hasMediaRecorder: !requireRecorder || typeof MediaRecorder !== "undefined",
  });
  return probed[key];
}

export default function BrowserGate({
  children,
  requireRecorder = true,
}: {
  children: ReactNode;
  requireRecorder?: boolean;
}) {
  const missing = useSyncExternalStore(
    subscribe,
    () => probe(requireRecorder),
    () => null,
  );

  if (missing === null || missing.length === 0) {
    return <>{children}</>;
  }

  return (
    <section
      role="alert"
      className={`${NOTICE} mt-6`}
    >
      <h2 className={SUB_HEADING}>
        This browser cannot run a live interview
      </h2>
      <p className="mt-2">
        {/* The same flag the probe used. Naming a requirement the probe did
            not check is how the unscored room came to tell a visitor that a
            live interview needs recording. */}
        {unsupportedBrowserMessage(missing, requireRecorder)}
      </p>
      <p className="mt-2">
        {SUPPORTED_BROWSERS_LINE}
      </p>
      <p className="mt-2 text-ink-faint">{IN_APP_BROWSER_HINT}</p>
    </section>
  );
}
