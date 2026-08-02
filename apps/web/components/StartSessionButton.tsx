"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function StartSessionButton({
  packageId,
  token,
}: {
  packageId: string;
  token: string;
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
      router.push(`/p/${token}/session/${data.session_id}`);
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
        className="self-start rounded-[10px] bg-coral px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#c96a4a] disabled:opacity-50"
      >
        {starting ? "Preparing your session…" : "Start session"}
      </button>
      {error ? <p className="text-sm text-coral">{error}</p> : null}
    </div>
  );
}
