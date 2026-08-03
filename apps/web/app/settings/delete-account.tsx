"use client";

import { useState } from "react";

import { ACCOUNT_DELETION_REMOVES, deletionConfirmationMatches } from "@/lib/account";

// F-34: the delete-account section of /settings.
//
// The confirmation is typing the account address, not a native browser
// dialog — those are forbidden here, and they are the wrong tool anyway:
// they interrupt rather than inform, and a reflex "OK" proves nothing.
// Typing the address takes deliberate effort and shows the person exactly
// which account they are about to destroy.
//
// On success the browser is sent to the landing page with a full navigation
// rather than a client-side push: the account is gone, so every cached RSC
// payload and router entry in this tab describes something that no longer
// exists. There is no signed-in surface left to route to.

const SUPPORT_LINE =
  "Your data is deleted. The sign-in record could not be removed automatically — email support and we will finish it.";

export default function DeleteAccountSection({
  accountEmail,
  supportHref,
}: {
  accountEmail: string | null;
  supportHref: string;
}) {
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const armed = deletionConfirmationMatches(accountEmail, typed);

  async function destroy() {
    setPending(true);
    setError(null);
    let response: Response;
    try {
      response = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmEmail: typed }),
      });
    } catch {
      setError(
        "We could not reach the server, so nothing was deleted. Try again in a moment.",
      );
      setPending(false);
      return;
    }
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      signInRecordRemoved?: boolean;
    };
    if (!response.ok) {
      setError(
        body.error ??
          "The deletion did not go through, so nothing was deleted. Try again in a moment.",
      );
      setPending(false);
      return;
    }
    if (body.signInRecordRemoved === false) {
      // Honest partial outcome: the data is gone, the sign-in record is not.
      // Stay on the page long enough to say so rather than redirecting into
      // a state that implies everything worked.
      setNotice(SUPPORT_LINE);
      setPending(false);
      return;
    }
    window.location.assign("/");
  }

  if (notice !== null) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">{notice}</p>
        <a
          href={supportHref}
          className="self-start rounded-md border border-neutral-300 px-4 py-1.5 text-sm dark:border-neutral-700"
        >
          Email support
        </a>
      </div>
    );
  }

  if (accountEmail === null) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          This account has no email address on record, so there is nothing to
          type as confirmation. Email support and we will delete it by hand.
        </p>
        <a
          href={supportHref}
          className="self-start rounded-md border border-neutral-300 px-4 py-1.5 text-sm dark:border-neutral-700"
        >
          Email support
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Deleting your account removes, immediately and permanently:
      </p>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-neutral-600 dark:text-neutral-400">
        {ACCOUNT_DELETION_REMOVES.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        There is no undo and no grace period. Days left on a paid package are
        not refunded — nothing survives to restore them to.
      </p>
      <label className="flex flex-col gap-2 text-sm">
        <span className="text-neutral-600 dark:text-neutral-400">
          Type <span className="font-medium text-neutral-900 dark:text-neutral-100">{accountEmail}</span>{" "}
          to confirm.
        </span>
        <input
          type="email"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          disabled={pending}
          autoComplete="off"
          spellCheck={false}
          aria-label="Type your account email to confirm deletion"
          className="w-full max-w-sm rounded-md border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700"
        />
      </label>
      <button
        type="button"
        onClick={destroy}
        disabled={!armed || pending}
        className="self-start rounded-md border border-red-300 px-4 py-1.5 text-sm text-red-700 disabled:cursor-not-allowed disabled:border-neutral-300 disabled:text-neutral-400 dark:border-red-800 dark:text-red-400 dark:disabled:border-neutral-700 dark:disabled:text-neutral-600"
      >
        {pending ? "Deleting…" : "Delete my account and all of my data"}
      </button>
      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
