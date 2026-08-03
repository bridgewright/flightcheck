// Whether a session's room access is still granted (F-12).
//
// Migration 006 added `sessions.access_token_expires_at` and
// `sessions.token_revoked_at`, both nullable with no backfill. This is where
// the web honours them: every path that GRANTS access to a live interview
// asks first.
//
// WHICH PATHS ASK, AND WHICH DELIBERATELY DO NOT
//
// Entry is gated: rendering the room, and minting the OpenAI ephemeral
// secret. Those are the moments access is being handed out, and refusing
// costs the candidate nothing they have already spent.
//
// Finishing is NOT gated: the recording upload and the session-complete
// call stay open. An interview that has already happened is evidence a
// customer paid for, and a capability that lapsed at minute 19 of a
// 20-minute session must not be the reason it is thrown away. Revocation
// stops the next session, not the one already recorded.
//
// Both readings fail closed: a value we cannot understand is not permission.
// Both nulls mean "not yet" — the behaviour that shipped before the columns
// existed — which is what keeps every pre-006 row working.

export type CapabilityState = "active" | "expired" | "revoked";

/** The two columns, as the worker serializes them onto a session row. */
export interface CapabilityFields {
  access_token_expires_at?: string | null;
  token_revoked_at?: string | null;
}

function present(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

export function sessionCapability(
  session: CapabilityFields,
  nowMs: number = Date.now(),
): CapabilityState {
  // Revocation first: it is a decision someone took deliberately, and it
  // outranks any expiry arithmetic. Any value at all means revoked —
  // including one we cannot parse, because a malformed revocation is still
  // a revocation.
  if (present(session.token_revoked_at)) {
    return "revoked";
  }
  if (!present(session.access_token_expires_at)) {
    return "active"; // null expiry means no expiry (migration 006)
  }
  const expiresAt = Date.parse(session.access_token_expires_at);
  if (Number.isNaN(expiresAt)) {
    return "expired";
  }
  return expiresAt > nowMs ? "active" : "expired";
}

/** Shown when the room is opened after access ended. Honest about the two
 * things the candidate needs: the session is not lost, and what to do. */
export const CAPABILITY_ENDED_MESSAGE =
  "Access to this session has ended. It has not been scored and it does " +
  "not count against your package. Start a new session from your home " +
  "screen, or write to us if this looks wrong.";
