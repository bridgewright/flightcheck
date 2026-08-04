"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ERROR_TEXT, FINE_PRINT, SECONDARY_BUTTON, SUBTLE } from "@/lib/ui";

// Deleting one package (F-53), from the packages overview.
//
// Two steps, in the page, never a native confirm(): the same reasoning
// /settings uses for account deletion, which is that a browser dialog
// interrupts instead of informing and a reflex OK proves nothing. The second
// step is where the consequences are actually stated, because that is the
// moment somebody is deciding.
//
// It asks for a click rather than a typed confirmation, and that is a
// deliberate difference from account deletion. Typing your own address to
// delete your whole account is proportionate; typing something to remove one
// of several packages is friction that teaches people to type past warnings.

export default function DeletePackageButton({
  packageId,
  title,
  sessionsUsed,
  action,
}: {
  packageId: string;
  title: string;
  sessionsUsed: number;
  action: (packageId: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setPending(true);
    setError(null);
    const result = await action(packageId);
    if (result.ok) {
      // The list this card sits in is now wrong, and so is the switcher in
      // the top bar. Refresh rather than removing the card locally: a card
      // that vanishes while the server still lists it is the state that
      // makes people wonder whether it really went.
      router.refresh();
      return;
    }
    setError(result.error ?? "The deletion didn't run. Try again in a moment.");
    setPending(false);
    setArmed(false);
  }

  if (!armed) {
    return (
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => setArmed(true)}
          className={`${SECONDARY_BUTTON} self-start`}
        >
          Delete
        </button>
        {error ? <p className={ERROR_TEXT}>{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className={SUBTLE}>
        {/* A package with nothing in it yet must not be described as losing
            "its 0 sessions", which is the sentence a count-agnostic template
            produces and which reads as a bug. */}
        Delete {title}? This removes its rubric
        {sessionsUsed === 0
          ? ""
          : sessionsUsed === 1
            ? ", its 1 session with its report and transcript, and its recording"
            : `, its ${sessionsUsed} sessions with their reports and transcripts, and every recording`}
        , immediately and permanently. There is no undo.
      </p>
      <p className={FINE_PRINT}>
        Your receipts stay in your order history. A receipt is a record of a
        payment, and deleting what it paid for does not unmake the payment.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          className={SECONDARY_BUTTON}
        >
          {pending ? "Deleting…" : "Delete permanently"}
        </button>
        <button
          type="button"
          onClick={() => setArmed(false)}
          disabled={pending}
          className={SECONDARY_BUTTON}
        >
          Keep it
        </button>
      </div>
      {error ? <p className={ERROR_TEXT}>{error}</p> : null}
    </div>
  );
}
