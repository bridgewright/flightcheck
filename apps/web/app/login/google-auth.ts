// Whether the Google sign-in button renders (F-44).
//
// Until v0.6 this was a hardcoded `false` with a comment saying to flip it
// when the provider existed. That is a deploy of the app to change a fact
// about the environment, and it means the enabled path never runs anywhere
// except in whatever branch someone flipped it in.
//
// Now it is environment-driven, which makes it testable here and switchable
// per deployment: staging can carry a Google client before production does.
//
// The flag is intentionally the ONLY thing that is conditional. The OAuth
// call, the callback URL construction, and the error surface stay compiled
// and covered whether or not the button is shown, so turning it on cannot be
// the first time that code is exercised.

/**
 * Parse the flag value.
 *
 * Opt-in and strict: only the exact string "true" enables it. An unset
 * variable, an empty string, "1", "yes", or a typo all leave the button
 * hidden — the failure this protects against is a button that dead-ends on a
 * raw provider error page because the OAuth client was never configured, and
 * a lenient parse is exactly how that ships by accident.
 */
export function googleAuthEnabled(raw: string | undefined): boolean {
  return raw?.trim().toLowerCase() === "true";
}

/**
 * The build-time value.
 *
 * Read as a full static member expression, which is what Next requires to
 * inline a NEXT_PUBLIC_ variable into the client bundle — destructuring
 * `process.env` or indexing it dynamically yields undefined in the browser.
 */
export const GOOGLE_AUTH_ENABLED = googleAuthEnabled(
  process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED,
);
