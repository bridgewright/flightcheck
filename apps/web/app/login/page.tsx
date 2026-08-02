"use client";

import { FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

import { safeNextPath } from "../../lib/auth-redirect";
import { createClient } from "../../lib/supabase/client";
import { PRIMARY_BUTTON } from "../../lib/ui";

// The Google provider is not configured yet, so the button dead-ends on a raw
// error page. The whole OAuth path below stays wired and typechecked; turning
// it back on once the provider exists is this one line.
const GOOGLE_AUTH_ENABLED = false;

const FIELD =
  "w-full rounded-md border border-neutral-300 px-3 py-2.5 dark:border-neutral-700 dark:bg-neutral-900";
const SECONDARY_BUTTON =
  "w-full rounded-md border border-neutral-300 px-4 py-2.5 font-medium disabled:cursor-wait disabled:opacity-50 dark:border-neutral-700";

function LoginForm() {
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get("next"));
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const callbackUrl = () =>
    `${location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;

  async function continueWithGoogle() {
    setError(null);
    setPending(true);
    const { error: authError } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl() },
    });
    if (authError) {
      setError(authError.message);
      setPending(false);
    }
  }

  async function sendSignInLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const { error: authError } = await createClient().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callbackUrl() },
    });
    if (authError) {
      setError(authError.message);
      setPending(false);
      return;
    }
    setSent(true);
    setPending(false);
  }

  return (
    <main className="flex min-h-screen flex-1 items-center justify-center px-5 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-12 text-lg">
          <strong>flight</strong>check
        </div>
        <h1 className="mb-8 text-3xl font-bold tracking-tight text-balance">
          Your interviewer is ready when you are.
        </h1>
        {searchParams.get("error") === "auth" && (
          <p className="mb-4 text-sm text-red-600" role="alert">
            That sign-in link didn&apos;t work — it may have expired. Try again.
          </p>
        )}
        {error && (
          <p className="mb-4 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        {sent ? (
          <p>Check your email — we sent you a sign-in link.</p>
        ) : (
          <>
            {GOOGLE_AUTH_ENABLED ? (
              <>
                <button
                  className={SECONDARY_BUTTON}
                  type="button"
                  disabled={pending}
                  onClick={continueWithGoogle}
                >
                  Continue with Google
                </button>
                <div
                  aria-hidden="true"
                  className="my-5 text-center text-sm text-neutral-500"
                >
                  or
                </div>
              </>
            ) : null}
            <form onSubmit={sendSignInLink}>
              <label htmlFor="email" className="mb-2 block text-sm">
                Email
              </label>
              <input
                id="email"
                className={FIELD}
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <button
                className={`${PRIMARY_BUTTON} mt-3 w-full`}
                type="submit"
                disabled={pending}
              >
                Send sign-in link
              </button>
            </form>
          </>
        )}
        <p className="mt-6 text-sm text-neutral-600 dark:text-neutral-400">
          We only use your email to keep your sessions and reports in one place.
          No spam, no sharing.
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
