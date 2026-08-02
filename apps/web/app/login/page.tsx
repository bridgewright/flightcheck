"use client";

import { FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

import { safeNextPath } from "../../lib/auth-redirect";
import { createClient } from "../../lib/supabase/client";

const styles = {
  page: {
    alignItems: "center",
    background: "#0a0f1e",
    color: "#ece9dc",
    display: "flex",
    flex: 1,
    justifyContent: "center",
    minHeight: "100vh",
    padding: "32px 20px",
  },
  column: { maxWidth: 360, width: "100%" },
  wordmark: {
    fontFamily: "Georgia, serif",
    fontSize: 22,
    marginBottom: 48,
  },
  heading: {
    fontFamily: "Georgia, serif",
    fontSize: 36,
    lineHeight: 1.12,
    margin: "0 0 32px",
  },
  field: {
    background: "#101830",
    border: "1px solid #24304e",
    borderRadius: 8,
    color: "#ece9dc",
    fontSize: 16,
    padding: "13px 14px",
    width: "100%",
  },
  button: {
    background: "#d97757",
    border: "1px solid #d97757",
    borderRadius: 8,
    color: "white",
    cursor: "pointer",
    fontSize: 15,
    fontWeight: 600,
    padding: "13px 16px",
    width: "100%",
  },
  googleButton: {
    background: "transparent",
    border: "1px solid #24304e",
    borderRadius: 8,
    color: "#ece9dc",
    cursor: "pointer",
    fontSize: 15,
    fontWeight: 600,
    padding: "13px 16px",
    width: "100%",
  },
  muted: { color: "#939cb4", fontSize: 13, lineHeight: 1.5 },
  error: { color: "#f2a38b", fontSize: 14, lineHeight: 1.5 },
};

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
    <main style={styles.page}>
      <div style={styles.column}>
        <div style={styles.wordmark}>
          <strong>flight</strong>check
        </div>
        <h1 style={styles.heading}>Your interviewer is ready when you are.</h1>
        {searchParams.get("error") === "auth" && (
          <p style={styles.error} role="alert">
            That sign-in link didn&apos;t work — it may have expired. Try again.
          </p>
        )}
        {error && (
          <p style={styles.error} role="alert">
            {error}
          </p>
        )}
        {sent ? (
          <p>Check your email — we sent you a sign-in link.</p>
        ) : (
          <>
            <button
              className="auth-control"
              style={styles.googleButton}
              type="button"
              disabled={pending}
              onClick={continueWithGoogle}
            >
              Continue with Google
            </button>
            <div
              aria-hidden="true"
              style={{ color: "#939cb4", margin: "20px 0", textAlign: "center" }}
            >
              or
            </div>
            <form onSubmit={sendSignInLink}>
              <label htmlFor="email" style={{ display: "block", marginBottom: 8 }}>
                Email
              </label>
              <input
                className="auth-control"
                id="email"
                style={styles.field}
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <button
                className="auth-control"
                style={{ ...styles.button, marginTop: 12 }}
                type="submit"
                disabled={pending}
              >
                Send sign-in link
              </button>
            </form>
          </>
        )}
        <p style={{ ...styles.muted, marginTop: 24 }}>
          We only use your email to keep your sessions and reports in one place.
          No spam, no sharing.
        </p>
        <style jsx>{`
          .auth-control:focus-visible {
            outline: 3px solid #ece9dc;
            outline-offset: 3px;
          }

          button:disabled {
            cursor: wait;
            opacity: 0.65;
          }
        `}</style>
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
