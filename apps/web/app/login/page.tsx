"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { safeNextPath } from "../../lib/auth-redirect";
import { remainingCooldown, resendLabel } from "../../lib/resend-cooldown";
import { createClient } from "../../lib/supabase/client";
import {
  ERROR_TEXT,
  FIELD,
  FINE_PRINT,
  MUTED,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  SUBTLE,
} from "../../lib/ui";
import { GOOGLE_AUTH_ENABLED } from "./google-auth";

function LoginForm() {
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get("next"));
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  // Sent-state + resend gate: sentAt drives both ("sent" = sentAt !== null).
  // The countdown keeps resend rate-limit friendly — Supabase throttles OTP
  // sends, and a hammered resend would lock the user out for far longer.
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const callbackUrl = () =>
    `${location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;

  useEffect(() => {
    if (sentAt === null) return;
    const tick = () => setRemaining(remainingCooldown(sentAt, Date.now()));
    tick();
    // Keeps ticking after reaching 0; setState with an unchanged value is a
    // no-op re-render-wise, and the interval dies with the sent state.
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sentAt]);

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

  // Shared by the form submit and the resend button; a resend restarts the
  // cooldown, and a resend failure surfaces in the same error slot.
  async function sendLink() {
    setError(null);
    setPending(true);
    const { error: authError } = await createClient().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callbackUrl() },
    });
    setPending(false);
    if (authError) {
      setError(authError.message);
      return;
    }
    setSentAt(Date.now());
  }

  function sendSignInLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendLink();
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
          <p className={`${ERROR_TEXT} mb-4`} role="alert">
            That sign-in link didn&apos;t work — it may have expired. Try again.
          </p>
        )}
        {error && (
          <p className={`${ERROR_TEXT} mb-4`} role="alert">
            {error}
          </p>
        )}
        {sentAt !== null ? (
          <div className="flex flex-col gap-4">
            <p>Check your email — we sent you a sign-in link.</p>
            <p className={`${MUTED} text-sm`}>
              It can take a minute to arrive. If it isn&apos;t there, check
              your spam folder.
            </p>
            <button
              type="button"
              className={`${SECONDARY_BUTTON} w-full`}
              disabled={pending || remaining > 0}
              onClick={() => void sendLink()}
            >
              {resendLabel(remaining)}
            </button>
          </div>
        ) : (
          <>
            {GOOGLE_AUTH_ENABLED ? (
              <>
                <button
                  className={`${SECONDARY_BUTTON} w-full`}
                  type="button"
                  disabled={pending}
                  onClick={continueWithGoogle}
                >
                  Continue with Google
                </button>
                <div
                  aria-hidden="true"
                  className={`${SUBTLE} my-5 text-center`}
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
          </>
        )}
        <p className={`${MUTED} mt-6 text-sm`}>
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
