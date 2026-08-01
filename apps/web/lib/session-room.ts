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

/** Contract marker for injected clock notes — must match the planner's PACING rule. */
export const TIME_STATUS_PREFIX = "[time status]";

export interface TimeStatusCheckpoint {
  /** Fires once elapsed seconds reach this value. */
  atS: number;
  /** Note text, always starting with TIME_STATUS_PREFIX. */
  text: string;
}

/**
 * Clock notes injected into the interviewer's context — the model has no
 * clock, so the client is the clock. At 75% elapsed: steer toward wrap-up.
 * At the wrap-up margin (budget minus two minutes, the planner's "ask no
 * new questions" point): close out.
 */
export function timeStatusCheckpoints(
  budgetS: number = SESSION_BUDGET_S,
): TimeStatusCheckpoint[] {
  const threeQuartersAt = Math.round(budgetS * 0.75);
  const wrapUpAt = budgetS - 120;
  const threeQuartersMin = Math.round((budgetS - threeQuartersAt) / 60);
  const wrapUpMin = Math.round((budgetS - wrapUpAt) / 60);
  return [
    {
      atS: threeQuartersAt,
      text: `${TIME_STATUS_PREFIX} About ${threeQuartersMin} minutes remain — start steering toward wrap-up.`,
    },
    {
      atS: wrapUpAt,
      text: `${TIME_STATUS_PREFIX} About ${wrapUpMin} minutes remain — ask at most one short final question, then close the interview.`,
    },
  ];
}

/** The next unsent checkpoint if elapsed time has reached it, else null. */
export function dueTimeStatus(
  elapsedS: number,
  sentCount: number,
  checkpoints: TimeStatusCheckpoint[] = timeStatusCheckpoints(),
): TimeStatusCheckpoint | null {
  const next = checkpoints[sentCount];
  return next !== undefined && elapsedS >= next.atS ? next : null;
}

/**
 * Kick the interviewer's first response. Server-VAD realtime models never
 * speak unprompted — without this nudge at data-channel open, Morgan waits
 * silently for audio and the scripted opening never happens (observed in
 * the 2026-08-01 v0.2 test session: ~1 minute of mutual silence).
 */
export function greetingTriggerEvent(): string {
  return JSON.stringify({ type: "response.create" });
}

/**
 * Realtime payload adding a system note to the conversation WITHOUT forcing
 * a response: the note lands in context and shapes the interviewer's next
 * turn instead of interrupting the candidate mid-answer.
 */
export function timeStatusEvent(text: string): string {
  return JSON.stringify({
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "system",
      content: [{ type: "input_text", text }],
    },
  });
}
