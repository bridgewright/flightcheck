// Pure helpers for the session room. No DOM, no network: everything here is
// unit-testable, and the WebRTC plumbing in SessionRoom.tsx stays thin.

/** Session budget shown to the candidate (global constraint: 20 minutes). */
export const SESSION_BUDGET_S = 1200;

/** Hard cut (global constraint: 25 minutes) — the client auto-ends here. */
export const HARD_CUT_S = 1500;

/** Format elapsed seconds as MM:SS with zero padding. */
export function formatTimer(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const minutes = String(Math.floor(s / 60)).padStart(2, "0");
  const seconds = String(s % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

/**
 * Map one raw data-channel payload to a UI indicator.
 *
 * v0.1 handles exactly one event: "input_audio_buffer.speech_started" shows
 * a subtle "hearing you" indicator. Everything else — including malformed
 * JSON — is deliberately ignored rather than thrown, because a parse error
 * mid-interview must never take down the session.
 */
export function indicatorForEvent(raw: string): "listening" | null {
  try {
    const event = JSON.parse(raw) as { type?: unknown };
    return event.type === "input_audio_buffer.speech_started"
      ? "listening"
      : null;
  } catch {
    return null;
  }
}

/** True once elapsed time reaches the 25:00 hard cut. */
export function isHardCut(elapsedSeconds: number): boolean {
  return elapsedSeconds >= HARD_CUT_S;
}
