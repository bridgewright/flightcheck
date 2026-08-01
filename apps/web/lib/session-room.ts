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

/** Contract marker for injected silence notes — must match the planner's
 * PAUSES AND SILENCE rule. */
export const SILENCE_STATUS_PREFIX = "[silence status]";

/** A candidate sound episode shorter than this is a stall blip (filler,
 * cough): it pauses the silence clock instead of resetting it. */
export const STALL_BLIP_MAX_S = 2.0;

/** Quiet seconds between a committed turn and the client-armed
 * response.create — the room to resume that server VAD (900 ms) doesn't give. */
export const RESPONSE_DEBOUNCE_S = 1.2;

/** A tick longer than this did not measure real silence: the tab was
 * backgrounded, throttled, or the machine slept. */
export const SUSPEND_GAP_S = 2.0;

/**
 * Seconds between two ticker callbacks, read from a monotonic clock.
 *
 * The ticker must never assume its own interval. A throttled tab delivers
 * parked time as either one very late callback or a burst of queued ones,
 * and only a wall-clock delta tells those apart from real elapsed silence.
 * A clock that fails to advance (or reports garbage) yields 0 rather than a
 * negative or NaN tick, which would poison every accumulator downstream.
 */
export function tickDeltaS(nowMs: number, lastMs: number): number {
  const dtS = (nowMs - lastMs) / 1000;
  return Number.isFinite(dtS) && dtS > 0 ? dtS : 0;
}

export interface SilenceStage {
  /** Fires once accumulated quiet reaches this many seconds. */
  at: number;
  text: string;
}

/** Staged scaffolds (spec D3): light reassurance, directional hint, offer to
 * move on. Each fires at most once per quiet stretch. */
export const SILENCE_STAGES: SilenceStage[] = [
  {
    at: 8,
    text:
      `${SILENCE_STATUS_PREFIX} The candidate has been quiet for about ` +
      'eight seconds. Say only a short, warm "Take your time." — nothing else.',
  },
  {
    at: 15,
    text:
      `${SILENCE_STATUS_PREFIX} The candidate has been quiet for about ` +
      "fifteen seconds. Offer one directional hint toward where they were " +
      "heading — never the answer itself.",
  },
  {
    at: 30,
    text:
      `${SILENCE_STATUS_PREFIX} The candidate has been quiet for about ` +
      'thirty seconds. Gently offer to set this question aside — in the ' +
      'spirit of "We can come back to this one — want to try the next one ' +
      'instead?" — and let them choose.',
  },
];

export interface SilenceClockState {
  /** Accumulated room-quiet seconds (survives stall blips). */
  quietS: number;
  /** Length of the candidate's current sound episode, 0 while quiet. */
  episodeS: number;
  /** Stages already fired in this quiet stretch. */
  stagesSent: number;
  /** Seconds until a client-armed response.create, null when none pending. */
  responseDueInS: number | null;
}

export const INITIAL_SILENCE_STATE: SilenceClockState = {
  quietS: 0,
  episodeS: 0,
  stagesSent: 0,
  responseDueInS: null,
};

export interface SilenceTick {
  dtS: number;
  candidateAudible: boolean;
  interviewerAudible: boolean;
  /** True when an input_audio_buffer.committed arrived since the last tick. */
  commitArrived: boolean;
}

export interface SilenceEffects {
  /** Send silenceStatusEvent(stage.text) + responseTriggerEvent(). */
  stage: SilenceStage | null;
  /** Send responseTriggerEvent() — the debounced answer to a committed turn. */
  triggerResponse: boolean;
}

/**
 * One tick of the client-owned silence clock (spec sections 1 + 6a).
 * Pure: drives every response.create and every [silence status] note.
 * - Every commit arms a debounced response; any candidate sound cancels it
 *   (they were not done — Morgan judges completeness when he does speak).
 * - Candidate speech ≥ STALL_BLIP_MAX_S resets the quiet stretch; shorter
 *   episodes (fillers) and interviewer audio only pause it.
 */
export function nextSilenceState(
  state: SilenceClockState,
  tick: SilenceTick,
): { state: SilenceClockState; effects: SilenceEffects } {
  let { quietS, episodeS, stagesSent, responseDueInS } = state;
  const effects: SilenceEffects = { stage: null, triggerResponse: false };

  if (tick.dtS >= SUSPEND_GAP_S) {
    // Resume from suspension. A candidate whose tab was backgrounded stepped
    // away from the interview, so none of the parked time was silence they
    // sat through — crediting it fast-forwards the ladder and empties every
    // queued scaffold into their ear the moment they come back. Morgan
    // resumes quietly from a fresh stretch, as a human would after glancing
    // up. Nothing is emitted on this tick, including a response armed before
    // the gap: the moment it was meant for is gone.
    return {
      state: { quietS: 0, episodeS: 0, stagesSent: 0, responseDueInS: null },
      effects,
    };
  }
  if (tick.commitArrived) {
    responseDueInS = RESPONSE_DEBOUNCE_S;
  }
  if (tick.interviewerAudible) {
    // Interviewer audibility wins over the mic. In the open-speakers
    // environment Morgan's own voice re-enters the microphone, so a
    // "candidate audible" tick overlapping his audio is as likely to be
    // leaked echo as a barge-in — and treating leaked echo as speech reset
    // the quiet stretch, which made the scaffold ladder repeat stage 1
    // forever instead of escalating. A real barge-in still resets the
    // stretch: it outlives Morgan's audio and lands in the branch below.
    episodeS = 0;
  } else if (tick.candidateAudible) {
    responseDueInS = null;
    episodeS += tick.dtS;
    if (episodeS >= STALL_BLIP_MAX_S) {
      quietS = 0;
      stagesSent = 0;
    }
  } else {
    episodeS = 0;
    quietS += tick.dtS;
    // The tick that carried the commit contributes nothing to the debounce:
    // its interval holds the tail of the utterance the commit closes, not
    // the room going quiet. Counting it handed the candidate one tick less
    // room to resume than RESPONSE_DEBOUNCE_S promises — and on a jittery
    // tick longer than the debounce itself, no room at all.
    if (responseDueInS !== null && !tick.commitArrived) {
      responseDueInS -= tick.dtS;
      if (responseDueInS <= 0) {
        responseDueInS = null;
        effects.triggerResponse = true;
      }
    }
    const next = SILENCE_STAGES[stagesSent];
    if (next !== undefined && quietS >= next.at) {
      // A scaffold speaks for itself (the wiring sends a response.create
      // with it), so it supersedes a debounced response falling on the same
      // tick — otherwise this one tick asks Morgan to speak twice.
      effects.stage = next;
      effects.triggerResponse = false;
      stagesSent += 1;
      responseDueInS = null;
    }
  }
  return { state: { quietS, episodeS, stagesSent, responseDueInS }, effects };
}

/** Same payload as timeStatusEvent — a system note that shapes the next turn. */
export function silenceStatusEvent(text: string): string {
  return timeStatusEvent(text);
}

/** response.create — the only way Morgan ever speaks (create_response is
 * false). Also used for the opening greeting. */
export function responseTriggerEvent(): string {
  return greetingTriggerEvent();
}

/** Map a raw data-channel payload to the silence clock's input events. */
export function speechStateForEvent(
  raw: string,
): "started" | "stopped" | "committed" | null {
  try {
    const event = JSON.parse(raw) as { type?: unknown };
    switch (event.type) {
      case "input_audio_buffer.speech_started":
        return "started";
      case "input_audio_buffer.speech_stopped":
        return "stopped";
      case "input_audio_buffer.committed":
        return "committed";
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * Map a raw data-channel payload to the interviewer's audio lifecycle.
 *
 * Two independent sources exist for "Morgan is audible" because neither is
 * guaranteed: output_audio_buffer.* events are WebRTC-specific and clean,
 * but the 2026-08-01 live session showed the machinery must not depend on
 * any single signal (the analyser-only gate left the whole clock inert and
 * Morgan silent after the greeting). "response_done" doubles as the
 * clock-activation gate: once any response completes, the session is live.
 */
export function interviewerStateForEvent(
  raw: string,
): "speaking" | "quiet" | "response_done" | null {
  try {
    const event = JSON.parse(raw) as { type?: unknown };
    switch (event.type) {
      case "output_audio_buffer.started":
        return "speaking";
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        return "quiet";
      case "response.done":
        return "response_done";
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** Echo physics: leaked interviewer audio can only exist while (or just
 * after) the interviewer is audible. Candidate speech STARTING inside this
 * window is echo-suspect. */
export const ECHO_START_WINDOW_MS = 400;

/** A suspect episode is real speech only if it outlives the interviewer's
 * audio by more than the VAD tail (900 ms) plus a real margin — an echo
 * dies with its source, a barge-in keeps going. */
export const ECHO_OUTLIVE_MS = 2400;

/** item_id of an input_audio_buffer.committed payload, else null. */
export function committedItemId(raw: string): string | null {
  try {
    const event = JSON.parse(raw) as { type?: unknown; item_id?: unknown };
    return event.type === "input_audio_buffer.committed" &&
      typeof event.item_id === "string"
      ? event.item_id
      : null;
  } catch {
    return null;
  }
}

/** Remove an echo-committed item from the conversation so the model never
 * mistakes its own leaked words for a candidate answer. */
export function itemDeleteEvent(itemId: string): string {
  return JSON.stringify({ type: "conversation.item.delete", item_id: itemId });
}
