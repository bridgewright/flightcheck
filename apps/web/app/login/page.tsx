"use client";

import { Suspense, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { safeNextPath } from "../../lib/auth-redirect";
import { createClient } from "../../lib/supabase/client";
import {
  ERROR_TEXT,
  FINE_PRINT,
  MUTED,
  PAGE_HEADING,
  PRIMARY_BUTTON,
} from "../../lib/ui";

// One door: Google. The email link this screen used to offer is gone
// (DECISIONS 036) — it made the product's only entrance a message that has
// to arrive, and the message it sent was Supabase's, not ours.
//
// The OAuth call navigates the tab away on success, so the only code that
// runs after it is the failure path. `pending` therefore never has to be
// cleared on the happy path; the browser leaves.

function LoginForm() {
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get("next"));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function continueWithGoogle() {
    setError(null);
    setPending(true);
    const { error: authError } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
      },
    });
    if (authError) {
      // Deliberately not the provider's own words: a raw OAuth error tells
      // the customer nothing and tells everyone else how we are wired.
      setError("We could not reach Google just then. Try again in a moment.");
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-1 items-center justify-center px-5 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-12 text-section">
          <strong>flight</strong>check
        </div>
        <h1 className={`${PAGE_HEADING} mb-8`}>
          Your interviewer is ready when you are.
        </h1>
        {searchParams.get("error") === "auth" && (
          <p className={`${ERROR_TEXT} mb-4`} role="alert">
            That sign-in didn&apos;t finish. Try again.
          </p>
        )}
        {error && (
          <p className={`${ERROR_TEXT} mb-4`} role="alert">
            {error}
          </p>
        )}
        <button
          className={`${PRIMARY_BUTTON} w-full`}
          type="button"
          disabled={pending}
          onClick={() => void continueWithGoogle()}
        >
          {/* The mark carries the recognition; the words carry the meaning.
           *
           * `alt=""` because it is not information: the label beside it
           * already says Google, and a screen reader announcing "Google logo,
           * Continue with Google" says it twice. `unoptimized` because this
           * is a 1KB vector that the image optimizer can only make bigger and
           * slower, and it is the first paint of the first screen. */}
          <Image
            src="/google-g.svg"
            alt=""
            width={16}
            height={16}
            unoptimized
            className="shrink-0"
          />
          Continue with Google
        </button>
        <p className={`${FINE_PRINT} mt-4`}>
          By continuing you agree to the{" "}
          <Link className="underline" href="/legal/terms">
            Terms
          </Link>{" "}
          and{" "}
          <Link className="underline" href="/legal/privacy">
            Privacy Policy
          </Link>
          .
        </p>
        <p className={`${MUTED} mt-6 text-fine`}>
          We read your name and email address from Google, and nothing else. We
          use them to keep your sessions and reports in one place. No posting,
          no contacts, no spam.
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
