"use client";

import { useSyncExternalStore, type ReactNode } from "react";

import {
  IN_APP_BROWSER_HINT,
  SUPPORTED_BROWSERS_LINE,
  missingCapabilities,
  unsupportedBrowserMessage,
} from "@/lib/session-media";

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

let probed: string[] | null = null;

function probeMissing(): string[] {
  probed ??= missingCapabilities({
    hasGetUserMedia:
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getUserMedia === "function",
    hasRTCPeerConnection: typeof RTCPeerConnection !== "undefined",
    hasMediaRecorder: typeof MediaRecorder !== "undefined",
  });
  return probed;
}

export default function BrowserGate({ children }: { children: ReactNode }) {
  const missing = useSyncExternalStore(subscribe, probeMissing, () => null);

  if (missing === null || missing.length === 0) {
    return <>{children}</>;
  }

  return (
    <section
      role="alert"
      className="mt-6 rounded-lg border border-neutral-300 p-4 dark:border-neutral-700"
    >
      <h2 className="text-sm font-medium">
        This browser cannot run a live interview
      </h2>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        {unsupportedBrowserMessage(missing)}
      </p>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        {SUPPORTED_BROWSERS_LINE}
      </p>
      <p className="mt-2 text-sm text-neutral-500">{IN_APP_BROWSER_HINT}</p>
    </section>
  );
}
