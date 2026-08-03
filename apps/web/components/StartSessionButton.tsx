"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { startFailureView, type StartFailureView } from "@/lib/start-session";
import { NOTICE, PRIMARY_BUTTON, SUB_HEADING } from "@/lib/ui";

export default function StartSessionButton({
  packageId,
  label = "Start session",
}: {
  packageId: string;
  /** The CTA wording: pages that know the session number say so. */
  label?: string;
}) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [failure, setFailure] = useState<StartFailureView | null>(null);

  async function start() {
    setStarting(true);
    setFailure(null);
    try {
      // A package id and nothing else. /api/sessions takes its viewer branch
      // and proves ownership against the signed-in account rather than
      // against a bearer string, so no capability has to reach the browser
      // for this button to work.
      //
      // This component used to accept an optional `token` and forward it. The
      // route still honours a token in the body, but that is its server-side
      // legacy path and it stays until F-10 retires loose tokens; nothing on
      // the client needs to reach it. The prop was the last channel through
      // which a package access token could be serialized into an RSC payload,
      // which is the exact shape 79838fd closed, and it went dead in that same
      // commit without being removed.
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package_id: packageId }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        session_id?: string;
        error?: string;
        code?: string;
      };
      if (!response.ok || !data.session_id) {
        // The route forwards the worker's status and machine code; the
        // mapping — not the raw error string — decides what the user reads.
        setFailure(startFailureView(response.status, data.code ?? null));
        setStarting(false);
        return;
      }
      // Straight into the room: the session was just created on purpose, so
      // an interstitial page would only restate the button the user pressed.
      router.push(`/sessions/${data.session_id}/room`);
    } catch {
      // The fetch itself failed — no response, no status. Same honest state
      // as a gateway failure: the service is unreachable, the package is
      // untouched.
      setFailure(startFailureView(0, null));
      setStarting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={start}
        disabled={starting}
        className={`${PRIMARY_BUTTON} self-start`}
      >
        {starting ? "Preparing your session…" : label}
      </button>
      {failure ? (
        <div
          role="alert"
          className={`${NOTICE} max-w-md`}
        >
          <p className={SUB_HEADING}>{failure.title}</p>
          <p className="mt-1">
            {failure.message}
          </p>
        </div>
      ) : null}
    </div>
  );
}
