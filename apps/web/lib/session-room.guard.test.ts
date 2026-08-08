import { describe, expect, it } from "vitest";

import {
  CONNECTION_LOST_MESSAGE,
  DISCONNECTED_GRACE_S,
  INITIAL_GUARD_STATE,
  STARVATION_TRIP_S,
  SUSPEND_GAP_S,
  nextGuardState,
  type ConnectionGuardState,
  type GuardTick,
} from "./session-room";

/** A healthy quarter-second tick; override what each case needs. */
function tick(overrides: Partial<GuardTick> = {}): GuardTick {
  return {
    dtS: 0.25,
    connectionState: "connected",
    dcOpen: true,
    messageArrived: false,
    responseRequested: false,
    responseDone: false,
    candidateAudible: false,
    interviewerAudible: false,
    ...overrides,
  };
}

function run(
  ticks: GuardTick[],
  initial: ConnectionGuardState = INITIAL_GUARD_STATE,
) {
  let state = initial;
  let endReason: ReturnType<typeof nextGuardState>["endReason"] = null;
  for (const t of ticks) {
    const step = nextGuardState(state, t);
    state = step.state;
    if (step.endReason !== null && endReason === null) {
      endReason = step.endReason;
    }
  }
  return { state, endReason };
}

const times = (n: number, t: GuardTick) => Array.from({ length: n }, () => t);

describe("nextGuardState — healthy session", () => {
  it("a connected, quiet, idle room never trips and accumulates nothing", () => {
    const { state, endReason } = run(times(400, tick()));
    expect(endReason).toBeNull();
    expect(state).toEqual(INITIAL_GUARD_STATE);
  });

  it("an AFK-silent room after the ladder is exhausted never trips", () => {
    // No candidate audio, no interviewer audio, nothing pending: even 60 s
    // of message-free quiet is legal — "connection problem" would be a lie.
    const { endReason } = run(times(240, tick()));
    expect(endReason).toBeNull();
  });
});

describe("nextGuardState — ICE states", () => {
  it('"failed" trips immediately', () => {
    const { endReason } = run([tick({ connectionState: "failed" })]);
    expect(endReason).toBe("ice-failed");
  });

  it('"disconnected" below the grace period does not trip', () => {
    const n = Math.round(DISCONNECTED_GRACE_S / 0.25) - 1;
    const { endReason } = run(
      times(n, tick({ connectionState: "disconnected" })),
    );
    expect(endReason).toBeNull();
  });

  it('"disconnected" sustained past the grace period trips', () => {
    const n = Math.round(DISCONNECTED_GRACE_S / 0.25);
    const { endReason } = run(
      times(n, tick({ connectionState: "disconnected" })),
    );
    expect(endReason).toBe("ice-disconnected");
  });

  it("a recovery resets the disconnection accumulator", () => {
    const n = Math.round(DISCONNECTED_GRACE_S / 0.25) - 1;
    const { state, endReason } = run([
      ...times(n, tick({ connectionState: "disconnected" })),
      tick(),
      ...times(n, tick({ connectionState: "disconnected" })),
    ]);
    expect(endReason).toBeNull();
    expect(state.disconnectedForS).toBeCloseTo(n * 0.25, 5);
  });
});

describe("nextGuardState — data channel", () => {
  it("a closed channel mid-live trips immediately", () => {
    const { endReason } = run([tick({ dcOpen: false })]);
    expect(endReason).toBe("channel-closed");
  });
});

describe("nextGuardState — starvation (traffic expected, none arrives)", () => {
  it("an unanswered response.create trips at the starvation threshold", () => {
    // The greeting case: response requested, Morgan never answers, no
    // events ever arrive. The session ends honestly instead of hanging.
    const n = Math.round(STARVATION_TRIP_S / 0.25);
    const { endReason } = run([
      tick({ responseRequested: true }),
      ...times(n, tick()),
    ]);
    expect(endReason).toBe("starvation");
  });

  it("just below the threshold does not trip", () => {
    const n = Math.round(STARVATION_TRIP_S / 0.25) - 2;
    const { endReason } = run([
      tick({ responseRequested: true }),
      ...times(n, tick()),
    ]);
    expect(endReason).toBeNull();
  });

  it("any arriving message resets the starvation accumulator", () => {
    const n = Math.round(STARVATION_TRIP_S / 0.25) - 2;
    const { endReason, state } = run([
      tick({ responseRequested: true }),
      ...times(n, tick()),
      tick({ messageArrived: true }),
      ...times(n, tick()),
    ]);
    expect(endReason).toBeNull();
    expect(state.starvedS).toBeCloseTo(n * 0.25, 5);
  });

  it("response.done clears the pending marker and stops accumulation", () => {
    const { endReason, state } = run([
      tick({ responseRequested: true }),
      tick({ messageArrived: true, responseDone: true }),
      ...times(400, tick()),
    ]);
    expect(endReason).toBeNull();
    expect(state.starvedS).toBe(0);
    expect(state.responsePending).toBe(false);
  });

  it("a same-tick done + new request stays pending", () => {
    const { state } = run([
      tick({ responseRequested: true }),
      tick({ messageArrived: true, responseDone: true, responseRequested: true }),
    ]);
    expect(state.responsePending).toBe(true);
  });

  it("a long candidate answer NEVER reads as starvation", () => {
    // The 2026-08-08 field kill: server VAD speaks only at speech
    // boundaries, so a candidate mid-answer legitimately produces ZERO
    // data-channel traffic — and the guard read every answer longer than
    // STARVATION_TRIP_S as a dead connection and ended the session while
    // the customer was still talking. Candidate speech alone must expect
    // nothing. A genuinely dead transport is still caught by ice-failed /
    // channel-closed / ice-disconnected, and by starvation the moment a
    // response is owed or the interviewer is audible.
    const n = Math.round((STARVATION_TRIP_S * 20) / 0.25); // a 400 s answer
    const { endReason, state } = run(times(n, tick({ candidateAudible: true })));
    expect(endReason).toBeNull();
    expect(state.starvedS).toBe(0);
  });

  it("interviewer audio without any events accumulates starvation", () => {
    const n = Math.round(STARVATION_TRIP_S / 0.25);
    const { endReason } = run(times(n, tick({ interviewerAudible: true })));
    expect(endReason).toBe("starvation");
  });
});

describe("nextGuardState — suspension-gap amnesty (DECISIONS 011)", () => {
  it("a gap tick resets every accumulator and never trips", () => {
    const nearTrip = Math.round(STARVATION_TRIP_S / 0.25) - 2;
    const { state, endReason } = run([
      tick({ responseRequested: true }),
      ...times(nearTrip, tick()),
      tick({ dtS: 60 }),
    ]);
    expect(endReason).toBeNull();
    expect(state).toEqual(INITIAL_GUARD_STATE);
  });

  it("a gap tick clears a disconnection streak too", () => {
    const n = Math.round(DISCONNECTED_GRACE_S / 0.25) - 1;
    const { endReason } = run([
      ...times(n, tick({ connectionState: "disconnected" })),
      tick({ dtS: SUSPEND_GAP_S, connectionState: "disconnected" }),
      ...times(n, tick({ connectionState: "disconnected" })),
    ]);
    expect(endReason).toBeNull();
  });
});

describe("CONNECTION_LOST_MESSAGE", () => {
  it("pins the honest copy, including the slot promise", () => {
    expect(CONNECTION_LOST_MESSAGE).toBe(
      "We hit a connection problem, so this session has to end here. " +
        "It won't count against your package. Please try again in a few minutes.",
    );
  });
});
