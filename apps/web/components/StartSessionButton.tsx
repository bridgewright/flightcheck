"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      // The package access token rides along: /api/sessions requires it (the
      // v0.1 capability model) — a bare package UUID must not start sessions.
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package_id: packageId, token }),
      });
      const data = (await response.json()) as { session_id?: string; error?: string };
      if (!response.ok || !data.session_id) {
        throw new Error(data.error ?? `request failed (${response.status})`);
      }
      // Straight into the room: the session was just created on purpose, so
      // an interstitial page would only restate the button the user pressed.
      router.push(`/sessions/${data.session_id}/room`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "request failed");
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
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
