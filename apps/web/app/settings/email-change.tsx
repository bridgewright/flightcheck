"use client";

import { useState } from "react";

import { emailChangeOutcome, validateNewEmail } from "@/lib/account";
import { createClient } from "@/lib/supabase/client";
import { ERROR_TEXT, FIELD, SECONDARY_BUTTON } from "@/lib/ui";

// F-35: change the address you sign in with.
//
// Supabase does not change it on submit — it emails a confirmation link, and
// the old address keeps working until that link is opened. So this screen
// never shows a "changed" state. It shows what is true at that moment: a
// link is on its way, and you still sign in with the old address until you
// open it.
//
// It also never reveals whether the requested address already belongs to
// someone. lib/account.emailChangeOutcome gives the taken case and the
// available case the same conditional answer, which is true of both.

export default function EmailChangeSection({
  accountEmail,
}: {
  accountEmail: string | null;
}) {
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const check = validateNewEmail(accountEmail, typed);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    setPending(true);
    const supabase = createClient();
    const { error: authError } = await supabase.auth.updateUser(
      { email: check.email },
      // Land the confirmation back on this screen, the same way the magic
      // link lands on its `next` (app/login/page.tsx). Without it the link
      // goes to the project's Site URL and the person ends up somewhere
      // unrelated to the thing they were doing.
      { emailRedirectTo: `${location.origin}/auth/callback?next=%2Fsettings` },
    );
    const outcome = emailChangeOutcome(accountEmail, check.email, authError ?? null);
    if (outcome.kind === "pending") {
      setNotice(outcome.message);
      setTyped("");
    } else {
      setError(outcome.message);
    }
    setPending(false);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p className="text-sm text-ink-muted">
        We send a confirmation link to the new address, and your current
        address may receive one too. The change takes effect only once every
        link we send has been opened, so a typo here cannot lock you out.
      </p>
      <label className="flex flex-col gap-2 text-sm">
        <span className="text-ink-muted">New email address</span>
        <input
          type="email"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          disabled={pending}
          autoComplete="email"
          placeholder="you@example.com"
          aria-label="New email address"
          className={`${FIELD} max-w-sm`}
        />
      </label>
      <button
        type="submit"
        disabled={pending || typed.trim() === ""}
        className={`${SECONDARY_BUTTON} self-start`}
      >
        {pending ? "Sending…" : "Send confirmation link"}
      </button>
      {notice ? (
        <p className="text-sm text-ink-muted" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className={ERROR_TEXT} role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
