"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { startFailureView, type StartFailureView } from "@/lib/start-session";
import { PRIMARY_BUTTON } from "@/lib/ui";

export default function StartSessionButton({
  packageId,
  token,
  label = "Start session",
}: {
  packageId: string;
  token: string;
  /** The CTA wording — pages that know the session number say so. */
  label?: string;
}) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [failure, setFailure] = useState<StartFailureView | null>(null);

  async function start() {
    setStarting(true);
    setFailure(null);
    try {
      // The package access token rides along: /api/sessions requires it (the
      // v0.1 capability model) — a bare package UUID must not start sessions.
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package_id: packageId, token }),
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
          className="max-w-md rounded-md border border-neutral-300 p-3 dark:border-neutral-700"
        >
          <p className="text-sm font-medium">{failure.title}</p>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            {failure.message}
          </p>
        </div>
      ) : null}
    </div>
  );
}
