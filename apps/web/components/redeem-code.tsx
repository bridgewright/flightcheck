"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import { cbtRedeemCopy, type CbtRedeemResult } from "@/lib/cbt";
import { SECONDARY_BUTTON, SUBTLE } from "@/lib/ui";

export default function RedeemCode({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const code = String(form.get("code") ?? "").trim();
    if (code.length === 0 || code.length > 64) {
      setMessage(cbtRedeemCopy({ code: "invalid" }));
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/cbt/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = (await response.json().catch(() => ({ code: "unknown" }))) as CbtRedeemResult;
      const result = response.status === 429 ? { code: "rate-limited" as const } : body;
      setMessage(cbtRedeemCopy(result));
      if (response.ok) router.refresh();
    } catch {
      setMessage(cbtRedeemCopy({ code: "unknown" }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={`flex ${compact ? "items-end" : "items-center justify-center"} flex-wrap gap-2`}>
      <label className="flex flex-col gap-1 text-left">
        <span className={SUBTLE}>Have a beta access code?</span>
        <input name="code" maxLength={64} disabled={busy} className="rounded-control border border-field bg-paper px-3 py-2 text-ink" />
      </label>
      <button type="submit" disabled={busy} className={SECONDARY_BUTTON}>
        {busy ? "Checking..." : "Redeem code"}
      </button>
      {message ? <p className={`${SUBTLE} basis-full`}>{message}</p> : null}
    </form>
  );
}
