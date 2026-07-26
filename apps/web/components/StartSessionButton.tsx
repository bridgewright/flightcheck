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
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package_id: packageId }),
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
        className="self-start rounded-md bg-neutral-900 px-6 py-3 font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
      >
        {starting ? "Preparing your session…" : "Start session"}
      </button>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
