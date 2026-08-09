// Pure helpers for the session room. No DOM, no network: everything here is
// unit-testable, and the WebRTC plumbing in SessionRoom.tsx stays thin.

// --- Session timing -------------------------------------------------------
//
// SINGLE SOURCE: services/scorer/config/product.toml, [session]. The client
// owns the clock — this file shows the budget, injects the wrap-up notes,
// and enforces the hard cut — so a change made only on the scorer side would
// have had no effect on any interview. These constants mirror the TOML in
// its own unit (minutes), and two gates fail if they ever disagree:
// apps/web/tests/session-timing-ssot.test.ts and
// services/scorer/tests/test_session_timing_ssot.py.
// The standard keys are budget_minutes / hard_cut_minutes; the quick twins
// are quick_budget_minutes / quick_hard_cut_minutes. Change product.toml
// first; these follow.

/** [session] budget_minutes. */
export const SESSION_BUDGET_MINUTES = 20;

/** [session] hard_cut_minutes. */
export const SESSION_HARD_CUT_MINUTES = 25;

/** [session] quick_budget_minutes. */
export const QUICK_SESSION_BUDGET_MINUTES = 5;

/** [session] quick_hard_cut_minutes. */
export const QUICK_HARD_CUT_MINUTES = 8;

/** [session] heartbeat_interval_s. */
export const HEARTBEAT_INTERVAL_S = 15;

/** Session budget shown to the candidate. */
export const SESSION_BUDGET_S = SESSION_BUDGET_MINUTES * 60;

/** Hard cut — the client auto-ends here. */
export const HARD_CUT_S = SESSION_HARD_CUT_MINUTES * 60;

/** Quick-session budget shown to the candidate. */
export const QUICK_SESSION_BUDGET_S = QUICK_SESSION_BUDGET_MINUTES * 60;

/** Quick-session hard cut. */
export const QUICK_HARD_CUT_S = QUICK_HARD_CUT_MINUTES * 60;

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
export function isHardCut(elapsedSeconds: number, hardCutS = HARD_CUT_S): boolean {
  return elapsedSeconds >= hardCutS;
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
  const wrapUpAt = closingArmedAt(budgetS);
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

/** Finished-transcript sentinel shared with the planner's closing line. */
export const CLOSING_MARKER = "good luck out there";

/** Full-room quiet after the closing audio before normal completion. */
export const CLOSING_LINGER_S = 2.0;

/** The planner's two-minute wrap-up boundary, reused by closing detection. */
export function closingArmedAt(budgetS: number = SESSION_BUDGET_S): number {
  return budgetS - 120;
}

/** Quiet seconds between a committed turn and the client-armed
 * response.create. Server VAD retains the 0.9 s acoustic hesitation guard;
 * this 0.6 s client guard still catches a sentence resumed after an early
 * commit, while total required quiet falls from about 2.1 s to 1.5 s. */
export const RESPONSE_DEBOUNCE_S = 0.6;

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
  closingSeen: boolean;
  closingQuietS: number;
  interviewEnded: boolean;
}

export const INITIAL_SILENCE_STATE: SilenceClockState = {
  quietS: 0,
  episodeS: 0,
  stagesSent: 0,
  responseDueInS: null,
  closingSeen: false,
  closingQuietS: 0,
  interviewEnded: false,
};

export interface SilenceTick {
  dtS: number;
  candidateAudible: boolean;
  interviewerAudible: boolean;
  /** True when an input_audio_buffer.committed arrived since the last tick. */
  commitArrived: boolean;
  elapsedS?: number;
  finishedTranscript?: string | null;
}

export interface SilenceEffects {
  /** Send silenceStatusEvent(stage.text) + responseTriggerEvent(). */
  stage: SilenceStage | null;
  /** Send responseTriggerEvent() — the debounced answer to a committed turn. */
  triggerResponse: boolean;
  endInterview: boolean;
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
  let {
    quietS, episodeS, stagesSent, responseDueInS,
    closingSeen, closingQuietS, interviewEnded,
  } = state;
  const effects: SilenceEffects = {
    stage: null, triggerResponse: false, endInterview: false,
  };

  if (
    !closingSeen &&
    (tick.elapsedS ?? -1) >= closingArmedAt() &&
    tick.finishedTranscript?.toLowerCase().includes(CLOSING_MARKER)
  ) {
    closingSeen = true;
  }

  if (closingSeen) {
    responseDueInS = null;
    if (tick.candidateAudible || tick.interviewerAudible) {
      closingQuietS = 0;
    } else if (tick.dtS < SUSPEND_GAP_S && !interviewEnded) {
      closingQuietS += tick.dtS;
      if (closingQuietS >= CLOSING_LINGER_S) {
        interviewEnded = true;
        effects.endInterview = true;
      }
    }
    return {
      state: {
        quietS, episodeS, stagesSent, responseDueInS,
        closingSeen, closingQuietS, interviewEnded,
      },
      effects,
    };
  }

  if (tick.dtS >= SUSPEND_GAP_S) {
    // Resume from suspension. A candidate whose tab was backgrounded stepped
    // away from the interview, so none of the parked time was silence they
    // sat through — crediting it fast-forwards the ladder and empties every
    // queued scaffold into their ear the moment they come back. Morgan
    // resumes quietly from a fresh stretch, as a human would after glancing
    // up. Nothing is emitted on this tick, including a response armed before
    // the gap: the moment it was meant for is gone.
    return {
      state: {
        quietS: 0, episodeS: 0, stagesSent: 0, responseDueInS: null,
        closingSeen, closingQuietS, interviewEnded,
      },
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
  return {
    state: {
      quietS, episodeS, stagesSent, responseDueInS,
      closingSeen, closingQuietS, interviewEnded,
    },
    effects,
  };
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

/** Full interviewer utterance from a completed audio-transcript event. */
export function finishedTranscriptForEvent(raw: string): string | null {
  try {
    const event = JSON.parse(raw) as { type?: unknown; transcript?: unknown };
    return event.type === "response.output_audio_transcript.done" &&
      typeof event.transcript === "string"
      ? event.transcript
      : null;
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

// --- F-38: leaving the room ----------------------------------------------

/** Every state the room can be in. Declared here, not in the component, so
 * the unload guard below is exhaustive by construction. */
export const ROOM_PHASES = [
  "ready",
  "connecting",
  "live",
  "uploading",
  "done",
  "connection-lost",
] as const;

export type RoomPhase = (typeof ROOM_PHASES)[number];

/**
 * The warning to show if the tab is closed right now, or null when leaving
 * costs nothing.
 *
 * Two phases hold something the server does not have yet:
 * - "uploading": the recording exists only in this tab's memory until the
 *   PUT to storage lands. Closing loses an interview that cannot be redone.
 * - "live": the interview is in progress. The session row is still
 *   "planned" and the slot survives (complete is never called), but the
 *   time the candidate has already spent does not.
 *
 * Everything else is safe to leave: nothing is recorded yet ("ready",
 * "connecting"), or the recording is already with the server ("done"), or
 * the attempt was explicitly abandoned with the slot preserved
 * ("connection-lost").
 */
export function unloadWarningFor(phase: RoomPhase): string | null {
  switch (phase) {
    case "uploading":
      return "Your recording has not finished uploading. If you leave now it is lost.";
    case "live":
      return "Your interview is still running. If you leave now it ends without being scored.";
    case "ready":
    case "connecting":
    case "done":
    case "connection-lost":
      return null;
  }
}

// --- F-17: connection guard ----------------------------------------------

/** ICE "disconnected" sustained past this is a dead call, not a blip. */
export const DISCONNECTED_GRACE_S = 8;

/** Expected-traffic seconds with zero data-channel messages before the
 * session is declared starved. Tighter than a blanket no-events timeout on
 * purpose: a healthy silent room accumulates nothing (see the guard
 * reducer), so this only measures genuinely missing traffic. */
export const STARVATION_TRIP_S = 20;

export type GuardEndReason =
  | "ice-failed"
  | "ice-disconnected"
  | "channel-closed"
  | "starvation";

/** Honest copy for the connection-lost screen. The slot promise is real:
 * the client never calls complete on a guarded ending, the session row
 * stays "planned", and create_session is idempotent — the same link serves
 * a fresh attempt. */
export const CONNECTION_LOST_MESSAGE =
  "We hit a connection problem, so this session has to end here. " +
  "It won't count against your package. Please try again in a few minutes.";

export interface ConnectionGuardState {
  /** Seconds spent continuously in ICE "disconnected". */
  disconnectedForS: number;
  /** Expected-traffic seconds with no data-channel message. */
  starvedS: number;
  /** A response.create left the client with no response.done back yet. */
  responsePending: boolean;
}

export const INITIAL_GUARD_STATE: ConnectionGuardState = {
  disconnectedForS: 0,
  starvedS: 0,
  responsePending: false,
};

export interface GuardTick {
  dtS: number;
  /** RTCPeerConnection.connectionState at tick time. */
  connectionState: string;
  /** Data channel readyState === "open" at tick time. */
  dcOpen: boolean;
  /** Any data-channel message arrived since the last tick. */
  messageArrived: boolean;
  /** A response.create was sent since the last tick (greeting, scaffold,
   * debounced trigger). */
  responseRequested: boolean;
  /** A response.done arrived since the last tick. */
  responseDone: boolean;
  /** Deliberately NOT a traffic expectation: a candidate mid-answer
   * produces zero channel traffic (server VAD speaks only at speech
   * boundaries), and counting it starved every answer longer than the
   * trip window. Kept in the tick so the reducer's inputs stay a
   * complete picture of the room. */
  candidateAudible: boolean;
  interviewerAudible: boolean;
}

/**
 * One tick of the connection guard (spec: F-17). Pure, same contract as
 * nextSilenceState. Detection is honest by construction: starvation only
 * accumulates while traffic is EXPECTED — interviewer audible (his audio
 * streams transcript deltas and lifecycle events over the channel) or a
 * response in flight — so an AFK-silent candidate on a healthy connection
 * can idle forever without being lied to about a "connection problem".
 *
 * Candidate speech deliberately expects NOTHING (2026-08-08 field kill):
 * server VAD speaks only at speech boundaries, so a candidate mid-answer
 * produces zero channel traffic — and counting that silence as starvation
 * ended the session at exactly STARVATION_TRIP_S into every answer longer
 * than the trip window, which real interview answers routinely are. A
 * genuinely dead transport is still caught by ice-failed, channel-closed,
 * ice-disconnected, and by starvation the moment a response is owed.
 */
export function nextGuardState(
  state: ConnectionGuardState,
  tick: GuardTick,
): { state: ConnectionGuardState; endReason: GuardEndReason | null } {
  if (tick.dtS >= SUSPEND_GAP_S) {
    // Suspension amnesty (DECISIONS 011): parked time is absence, not
    // evidence. The silence clock drops its pending response across a gap,
    // so the guard drops its expectation of an answer to it too.
    return { state: { ...INITIAL_GUARD_STATE }, endReason: null };
  }
  let { disconnectedForS, starvedS, responsePending } = state;
  // done before requested: a same-tick completion + new request stays pending.
  if (tick.responseDone) responsePending = false;
  if (tick.responseRequested) responsePending = true;
  disconnectedForS =
    tick.connectionState === "disconnected"
      ? disconnectedForS + tick.dtS
      : 0;
  if (tick.messageArrived) {
    starvedS = 0;
  } else if (tick.interviewerAudible || responsePending) {
    starvedS += tick.dtS;
  }
  const next = { disconnectedForS, starvedS, responsePending };
  if (tick.connectionState === "failed") {
    return { state: next, endReason: "ice-failed" };
  }
  if (!tick.dcOpen) {
    return { state: next, endReason: "channel-closed" };
  }
  if (disconnectedForS >= DISCONNECTED_GRACE_S) {
    return { state: next, endReason: "ice-disconnected" };
  }
  if (starvedS >= STARVATION_TRIP_S) {
    return { state: next, endReason: "starvation" };
  }
  return { state: next, endReason: null };
}

// --- F-66: the room refuses a session that has already ended --------------
//
// The first real session ended "insufficient" 14 seconds in, and the room
// then let two more attempts join it: mint answered 200, every heartbeat
// answered 409, and the guard read the starved channel as network loss. The
// customer saw "Connection lost" for a session the server had already
// retired. The worker's mint route now refuses (409 session-not-live), and
// this is the client half: only a "planned" session opens the start card —
// the same predicate mint and heartbeat hold — and every other status,
// including ones this build has never heard of, fails closed into a screen
// that says what actually happened.
//
// The door out is home, and it is a real door: the worker's create_session
// resumes a "failed"/"insufficient" row and re-arms it to "planned", so the
// home CTA reopens THIS slot rather than bouncing off the same closed room.
// The two sentences below that promise a kept slot depend on that, and on
// quota.py leaving both statuses out of SLOT_CONSUMING_STATUSES.

/** What the closed room offers the candidate instead of a start card. */
export interface EndedRoomNotice {
  headline: string;
  detail: string;
  /** The session page is worth a link when a report exists (scored) or is
   * on its way (scoring); otherwise home is the only door offered. */
  showSessionLink: boolean;
}

/**
 * The honest notice for a room whose session cannot start, or null for a
 * "planned" session (the only status the worker will mint a secret for).
 * Statuses this build does not know fail closed: an unknown status is not
 * permission to interview.
 */
export function endedRoomNotice(status: string): EndedRoomNotice | null {
  switch (status) {
    case "planned":
      return null;
    case "scoring":
      return {
        headline: "This interview is already being scored",
        detail:
          "Your recording is with the scorer and the report is on its way. " +
          "This room stays closed so the attempt cannot be overwritten.",
        showSessionLink: true,
      };
    case "scored":
      return {
        headline: "This interview is already scored",
        detail:
          "Your report is ready. This room stays closed so the result " +
          "cannot change.",
        showSessionLink: true,
      };
    case "quick_done":
      return {
        headline: "This interview is already complete",
        detail: "The quick interview has ended. Continue to the sample report.",
        showSessionLink: true,
      };
    case "insufficient":
      return {
        headline: "This session has already ended",
        detail:
          "It ended before there was enough interview to score, so it kept " +
          "your session slot. Start it again from your home screen whenever " +
          "you are ready.",
        showSessionLink: false,
      };
    // Not folded into the default: "failed" keeps its slot exactly like
    // "insufficient" (quota.py, SLOT_CONSUMING_STATUSES), and a customer
    // whose one paid attempt died in scoring must be told that in the same
    // breath as the bad news. What failed differs, so the sentence does too.
    case "failed":
      return {
        headline: "This session has already ended",
        detail:
          "The attempt could not be scored, so it kept your session slot. " +
          "Start it again from your home screen whenever you are ready.",
        showSessionLink: false,
      };
    default:
      return {
        headline: "This session has already ended",
        detail:
          "It cannot continue in this room. Your home screen shows where " +
          "it stands and how to continue.",
        showSessionLink: false,
      };
  }
}
