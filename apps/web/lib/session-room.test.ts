import { describe, expect, it } from "vitest";

import {
  INITIAL_GATE_STATE,
  BARGE_LEVEL_MULTIPLE,
  BARGE_SUSTAIN_MS,
  CLOSING_LINGER_S,
  CLOSING_MARKER,
  HARD_CUT_S,
  GREETING_STAGES,
  LEAK_FLOOR,
  medianPeak,
  INITIAL_SILENCE_STATE,
  endedRoomNotice,
  RESPONSE_DEBOUNCE_S,
  SESSION_BUDGET_S,
  SILENCE_STAGES,
  SILENCE_STATUS_PREFIX,
  QUICK_SESSION_BUDGET_S,
  PLAYBACK_GATE_HANGOVER_S,
  STALL_BLIP_MAX_S,
  TURN_NUDGE_S,
  TURN_NUDGE_TEXT,
  TURN_STATUS_PREFIX,
  SUSPEND_GAP_S,
  TIME_STATUS_PREFIX,
  committedItemId,
  assistantOutputItemId,
  bargeCutDecision,
  dueTimeStatus,
  formatTimer,
  finishedTranscriptForEvent,
  itemDeleteEvent,
  greetingTriggerEvent,
  indicatorForEvent,
  interviewerStateForEvent,
  isHardCut,
  minutesRemaining,
  nextGateState,
  nextSilenceState,
  responseTriggerEvent,
  silenceStatusEvent,
  speechStateForEvent,
  timeStatusCheckpoints,
  timeStatusEvent,
  unscoredEndingOutcome,
  UNSCORED_ENDING_FAILURE_MESSAGE,
  type SilenceClockState,
  type SilenceTick,
} from "./session-room";

const silenceTick = (overrides: Partial<SilenceTick> = {}): SilenceTick => ({
  dtS: 0.25,
  candidateAudible: false,
  interviewerAudible: false,
  commitArrived: false,
  responseDone: false,
  ...overrides,
});

describe("bargeCutDecision", () => {
  it("requires sustained, adaptive-level speech without an echo veto", () => {
    expect(bargeCutDecision({ sustainedMs: BARGE_SUSTAIN_MS - 1, bargeMicMedian: 1, leakBaselineMedian: 0, corr: null })).toEqual({ cut: false, reason: "sustain" });
    expect(bargeCutDecision({ sustainedMs: BARGE_SUSTAIN_MS, bargeMicMedian: 0.014, leakBaselineMedian: 0, corr: null })).toEqual({ cut: false, reason: "level" });
    expect(bargeCutDecision({ sustainedMs: BARGE_SUSTAIN_MS, bargeMicMedian: BARGE_LEVEL_MULTIPLE * 0.02, leakBaselineMedian: 0.02, corr: { verdict: "echo", r: 1, lagMs: 0, n: 6 } })).toEqual({ cut: false, reason: "corr-echo" });
    expect(bargeCutDecision({ sustainedMs: BARGE_SUSTAIN_MS, bargeMicMedian: 0.015, leakBaselineMedian: 0, corr: null })).toEqual({ cut: true, reason: "cut" });
    expect(bargeCutDecision({ sustainedMs: BARGE_SUSTAIN_MS, bargeMicMedian: 0.015, leakBaselineMedian: 0, corr: { verdict: "indeterminate", r: 1, lagMs: 0, n: 2 } })).toEqual({ cut: true, reason: "cut" });
  });

  it("names the first failing condition when several fail at once", () => {
    // Every row below fails more than one condition, so the reason it
    // carries is evidence of the ORDER and not merely of the condition. The
    // trail's barge-hold entries are read as "which condition failed", and a
    // reordering would relabel them all without changing a single cut.
    const echo = { verdict: "echo" as const, r: 1, lagMs: 0, n: 6 };
    expect(bargeCutDecision({ sustainedMs: BARGE_SUSTAIN_MS - 1, bargeMicMedian: 0, leakBaselineMedian: 1, corr: echo }).reason).toBe("sustain");
    expect(bargeCutDecision({ sustainedMs: BARGE_SUSTAIN_MS, bargeMicMedian: 0, leakBaselineMedian: 1, corr: echo }).reason).toBe("level");
    expect(bargeCutDecision({ sustainedMs: BARGE_SUSTAIN_MS, bargeMicMedian: 3, leakBaselineMedian: 1, corr: echo }).reason).toBe("corr-echo");
  });

  it("raises the bar with the room's own leak, and floors it in an earphone room", () => {
    const quietRoom = { sustainedMs: BARGE_SUSTAIN_MS, leakBaselineMedian: 0, corr: null };
    expect(bargeCutDecision({ ...quietRoom, bargeMicMedian: BARGE_LEVEL_MULTIPLE * LEAK_FLOOR }).cut).toBe(true);
    expect(bargeCutDecision({ ...quietRoom, bargeMicMedian: BARGE_LEVEL_MULTIPLE * LEAK_FLOOR - 1e-6 }).cut).toBe(false);
    // The same speech in a loud open room has to clear that room's leak.
    const loudRoom = { sustainedMs: BARGE_SUSTAIN_MS, leakBaselineMedian: 0.1, corr: null };
    expect(bargeCutDecision({ ...loudRoom, bargeMicMedian: BARGE_LEVEL_MULTIPLE * LEAK_FLOOR }).cut).toBe(false);
    expect(bargeCutDecision({ ...loudRoom, bargeMicMedian: BARGE_LEVEL_MULTIPLE * 0.1 }).cut).toBe(true);
  });
});

describe("medianPeak", () => {
  it("takes the middle of a spiky series, never its mean", () => {
    // The two series the cut compares are short and spiky. One loud tick of
    // leak inflates a baseline mean enough to hide a real barge-in, and one
    // silent tick inside a barge episode drags its mean under the same bar,
    // so a mean here is a wrong cut in either direction.
    const leakWithOneSpike = [0.01, 0.01, 0.01, 0.01, 0.9];
    expect(medianPeak(leakWithOneSpike)).toBe(0.01);
    expect(medianPeak(leakWithOneSpike)).not.toBeCloseTo(0.188, 3);
    const bargeWithOneSilentTick = [0, 0.4, 0.5, 0.6];
    expect(medianPeak(bargeWithOneSilentTick)).toBeCloseTo(0.45, 10);
    expect(medianPeak([])).toBe(0);
    expect(medianPeak([0.3])).toBe(0.3);
    // Unsorted input, and the input is not mutated.
    const unsorted = [0.5, 0.1, 0.9];
    expect(medianPeak(unsorted)).toBe(0.5);
    expect(unsorted).toEqual([0.5, 0.1, 0.9]);
  });
});

describe("assistantOutputItemId", () => {
  it("extracts only assistant output items", () => {
    expect(assistantOutputItemId(JSON.stringify({ type: "response.output_item.added", item: { role: "assistant", id: "a1" } }))).toBe("a1");
    expect(assistantOutputItemId(JSON.stringify({ type: "response.output_item.added", item: { role: "user", id: "u1" } }))).toBeNull();
    expect(assistantOutputItemId("bad json")).toBeNull();
  });
});

describe("the turn policy's recorded numbers", () => {
  it("holds every lever DECISIONS 080-082 chose at the value it chose", () => {
    // These six are levers with field arithmetic and revisit conditions
    // behind them, and until now every test reached them through the symbol,
    // so any of them could have been retuned in silence. 0.45 in particular
    // is only safe BECAUSE of the cancel window (080): a revert to 0.6 undoes
    // half of one decision and leaves the other half standing, which is the
    // shape of change that has to argue for itself in DECISIONS.md first.
    expect(RESPONSE_DEBOUNCE_S).toBe(0.45);
    expect(TURN_NUDGE_S).toBe(3.0);
    expect(BARGE_SUSTAIN_MS).toBe(750);
    expect(BARGE_LEVEL_MULTIPLE).toBe(3);
    expect(LEAK_FLOOR).toBe(0.005);
    expect(TURN_STATUS_PREFIX).toBe("[turn status]");
  });

  it("keeps the nudge fuse shorter than the first scaffold rung", () => {
    // 082 makes the two ladders alternatives, and this ordering is what
    // decides between them in practice: while Morgan owes, his 3 s fuse
    // always burns down before the candidate-facing ladder's earliest rung
    // is due, so the nudge is what the room says. The reducer suppresses
    // stages while he owes as well, which is belt and braces at these
    // values and the whole guard the day either number moves.
    expect(TURN_NUDGE_S).toBeLessThan(SILENCE_STAGES[0].at);
    expect(TURN_NUDGE_S).toBeLessThan(GREETING_STAGES[0].at);
  });
});

describe("response cancel window and owes-speech ladder", () => {
  it("marks triggers in flight, clears on first audio or response.done", () => {
    const triggered = nextSilenceState(
      { ...INITIAL_SILENCE_STATE, responseDueInS: 0.1 },
      silenceTick(),
    );
    expect(triggered.effects.triggerResponse).toBe(true);
    expect(triggered.state.responseInFlight).toBe(true);
    expect(nextSilenceState(triggered.state, silenceTick({ interviewerAudible: true })).state.responseInFlight).toBe(false);
    expect(nextSilenceState(triggered.state, silenceTick({ responseDone: true })).state.responseInFlight).toBe(false);
  });

  it("cancels an in-flight response when the candidate resumes, but not on a gap", () => {
    const active = { ...INITIAL_SILENCE_STATE, responseInFlight: true };
    const resumed = nextSilenceState(active, silenceTick({ candidateAudible: true }));
    expect(resumed.effects.cancelResponse).toBe(true);
    expect(resumed.effects.triggerResponse).toBe(false);
    expect(resumed.state.responseInFlight).toBe(false);
    const gap = nextSilenceState(active, silenceTick({ dtS: SUSPEND_GAP_S }));
    expect(gap.effects.cancelResponse).toBe(false);
    expect(gap.state.responseInFlight).toBe(false);
  });

  it("nudges once after a non-question transcript and suppresses stages", () => {
    let result = nextSilenceState(INITIAL_SILENCE_STATE, silenceTick({ finishedTranscript: "  Let us cover the role.  " }));
    expect(result.state.morganOwesSpeech).toBe(true);
    result = nextSilenceState({ ...result.state, quietS: TURN_NUDGE_S - 0.25 }, silenceTick());
    expect(result.effects.turnNudge).toBe(true);
    expect(result.effects.stage).toBeNull();
    expect(result.state.morganOwesSpeech).toBe(false);
    expect(result.state.responseInFlight).toBe(true);
    expect(nextSilenceState(INITIAL_SILENCE_STATE, silenceTick({ finishedTranscript: "Ready?" })).state.morganOwesSpeech).toBe(false);
  });

  it("never nudges during candidate audio or after the closing marker", () => {
    const owing = {
      ...INITIAL_SILENCE_STATE,
      quietS: TURN_NUDGE_S,
      morganOwesSpeech: true,
    };
    expect(nextSilenceState(owing, silenceTick({ candidateAudible: true })).effects.turnNudge).toBe(false);
    const closing = nextSilenceState(owing, silenceTick({
      elapsedS: 1080,
      finishedTranscript: `And ${CLOSING_MARKER}.`,
    }));
    expect(closing.state.closingSeen).toBe(true);
    expect(closing.effects.turnNudge).toBe(false);
    // The closing line ends without a question on purpose — it is the one
    // turn 082 exempts. It must not leave an obligation behind that the
    // linger would then have to outrun.
    const closed = nextSilenceState(
      { ...INITIAL_SILENCE_STATE, closingSeen: true },
      silenceTick({ finishedTranscript: "That is all the time we have." }),
    );
    expect(closed.state.morganOwesSpeech).toBe(false);
    expect(closed.state.quietS).toBe(0);
  });

  it("publishes the exact turn note and greeting ladder", () => {
    expect(TURN_NUDGE_TEXT.startsWith(TURN_STATUS_PREFIX)).toBe(true);
    expect(GREETING_STAGES.map(({ at }) => at)).toEqual(SILENCE_STAGES.map(({ at }) => at));
    expect(GREETING_STAGES.map(({ text }) => text)).toEqual([
      `${SILENCE_STATUS_PREFIX} The candidate has not answered your audio check for about eight seconds. Warmly ask once more whether they can hear you. Check nothing else and do not move on.`,
      `${SILENCE_STATUS_PREFIX} Still no answer after about fifteen seconds. They may not be hearing you at all. Say you might be having audio trouble and that you will wait for them.`,
      `${SILENCE_STATUS_PREFIX} Still nothing after about thirty seconds. Gently say the room stays open and you are ready whenever they can hear you. Never move on to the interview.`,
    ]);
  });

  it("starts the fuse when Morgan's audio stops, not when his transcript lands", () => {
    // response.output_audio_transcript.done fires at GENERATION end. Today's
    // trail has it 2.1 s into an utterance whose audio ran nine more seconds,
    // so an owes-speech flag derived there is live while Morgan is still
    // audibly talking. The quiet accumulator is what keeps the fuse honest:
    // it does not advance on an audible tick, so the 3 s is measured from
    // the audio, not from the transcript.
    let result = nextSilenceState(
      INITIAL_SILENCE_STATE,
      silenceTick({ interviewerAudible: true, finishedTranscript: "We will cover three areas." }),
    );
    expect(result.state.morganOwesSpeech).toBe(true);
    expect(result.state.quietS).toBe(0);
    for (let i = 0; i < 36; i += 1) {
      result = nextSilenceState(result.state, silenceTick({ interviewerAudible: true }));
      expect(result.effects.turnNudge).toBe(false);
    }
    expect(result.state.quietS).toBe(0);
    const quietTicksToNudge: number[] = [];
    for (let i = 1; i <= 16; i += 1) {
      result = nextSilenceState(result.state, silenceTick());
      if (result.effects.turnNudge) quietTicksToNudge.push(i);
    }
    expect(quietTicksToNudge).toEqual([TURN_NUDGE_S / 0.25]);
  });

  it("lets a nudge consume a debounce expiring on the same tick", () => {
    // Reachable: a commit landing while Morgan still owed a question puts the
    // debounce's expiry and the 3 s fuse on one tick. Both effects mean a
    // response.create, and the nudge carries its own, so the tick must ask
    // him to speak exactly once.
    let result = nextSilenceState(
      INITIAL_SILENCE_STATE,
      silenceTick({ interviewerAudible: true, finishedTranscript: "We will look at scoping." }),
    );
    let state = { ...result.state, quietS: 2.25 };
    result = nextSilenceState(state, silenceTick({ commitArrived: true }));
    expect(result.state.quietS).toBe(2.5);
    state = result.state;
    result = nextSilenceState(state, silenceTick());
    expect(result.effects).toMatchObject({ turnNudge: false, triggerResponse: false });
    result = nextSilenceState(result.state, silenceTick());
    expect(result.state.quietS).toBe(3);
    expect(result.effects.turnNudge).toBe(true);
    expect(result.effects.triggerResponse).toBe(false);
    expect(result.effects.stage).toBeNull();
  });

  it("consumes a debounce still counting down when the nudge fires", () => {
    // The tick above catches the two effects landing together. This is the
    // near miss: the commit arrives while Morgan owes, the fuse burns out
    // first, and the debounce is left mid-count. Left armed it expires two
    // ticks later and asks him to speak a second time, 500 ms into the
    // continuation the nudge just requested.
    let result = nextSilenceState(
      INITIAL_SILENCE_STATE,
      silenceTick({ interviewerAudible: true, finishedTranscript: "Three areas, then." }),
    );
    result = nextSilenceState({ ...result.state, quietS: TURN_NUDGE_S - 0.25 }, silenceTick({ commitArrived: true }));
    expect(result.effects.turnNudge).toBe(true);
    expect(result.state.responseDueInS).toBeNull();
    const laterTriggers: number[] = [];
    for (let i = 1; i <= 8; i += 1) {
      result = nextSilenceState(result.state, silenceTick());
      if (result.effects.triggerResponse) laterTriggers.push(i);
    }
    expect(laterTriggers).toEqual([]);
  });

  it("does not let the ladder's own reassurance make Morgan owe a turn", () => {
    // The 8 s rung puts "Take your time." in Morgan's mouth: no question
    // mark, and every word of it is the room speaking for the candidate's
    // benefit. Read as a turn it made him owe speech, which nudged him three
    // seconds later into a candidate who was still thinking, and restarted
    // the ladder's clock so the next rung's "about fifteen seconds" ran to
    // roughly twenty-six.
    let result = nextSilenceState(
      { ...INITIAL_SILENCE_STATE, candidateCommitSeen: true },
      silenceTick({ interviewerAudible: true, finishedTranscript: "What did you do next?" }),
    );
    const fired: string[] = [];
    for (let i = 0; i < 32; i += 1) {
      result = nextSilenceState(result.state, silenceTick());
      if (result.effects.stage) fired.push(`stage ${result.effects.stage.at} at ${result.state.quietS}`);
    }
    expect(fired).toEqual(["stage 8 at 8"]);
    // The scaffold's transcript, mid-audio and then draining.
    result = nextSilenceState(
      result.state,
      silenceTick({ interviewerAudible: true, finishedTranscript: "Take your time." }),
    );
    expect(result.state.morganOwesSpeech).toBe(false);
    expect(result.state.quietS).toBe(8);
    for (let i = 0; i < 8; i += 1) {
      result = nextSilenceState(result.state, silenceTick({ interviewerAudible: true }));
    }
    for (let i = 0; i < 32; i += 1) {
      result = nextSilenceState(result.state, silenceTick());
      if (result.effects.turnNudge) fired.push(`nudge at ${result.state.quietS}`);
      if (result.effects.stage) fired.push(`stage ${result.effects.stage.at} at ${result.state.quietS}`);
    }
    expect(fired).toEqual(["stage 8 at 8", "stage 15 at 15"]);
  });

  it("uses greeting stages until a commit is permanently seen", () => {
    const greeting = nextSilenceState({ ...INITIAL_SILENCE_STATE, quietS: 7.75 }, silenceTick());
    expect(greeting.effects.stage?.text).toContain("audio check");
    expect(greeting.state.responseInFlight).toBe(true);
    const committed = nextSilenceState(INITIAL_SILENCE_STATE, silenceTick({ commitArrived: true }));
    expect(committed.state.candidateCommitSeen).toBe(true);
    const later = nextSilenceState({ ...committed.state, quietS: 7.75, responseDueInS: null }, silenceTick());
    expect(later.effects.stage?.text).toBe(SILENCE_STAGES[0].text);
    const gap = nextSilenceState(later.state, silenceTick({ dtS: SUSPEND_GAP_S }));
    expect(gap.state.candidateCommitSeen).toBe(true);
  });
});

describe("nextGateState", () => {
  it("raises once and refills the hangover while the interviewer is audible", () => {
    const raised = nextGateState(INITIAL_GATE_STATE, {
      dtS: 0.25,
      interviewerAudible: true,
    });
    expect(raised).toEqual({
      state: { applied: "gated", hangoverS: PLAYBACK_GATE_HANGOVER_S },
      effect: "raise",
    });
    expect(
      nextGateState(
        { applied: "gated", hangoverS: 0.25 },
        { dtS: 0.25, interviewerAudible: true },
      ),
    ).toEqual({
      state: { applied: "gated", hangoverS: PLAYBACK_GATE_HANGOVER_S },
      effect: null,
    });
  });

  it("counts down silence and restores exactly when the hangover expires", () => {
    const waiting = nextGateState(
      { applied: "gated", hangoverS: 0.5 },
      { dtS: 0.25, interviewerAudible: false },
    );
    expect(waiting).toEqual({
      state: { applied: "gated", hangoverS: 0.25 },
      effect: null,
    });
    expect(
      nextGateState(waiting.state, {
        dtS: 0.25,
        interviewerAudible: false,
      }),
    ).toEqual({
      state: { applied: "resting", hangoverS: 0 },
      effect: "restore",
    });
  });

  it("restores immediately after a suspension gap", () => {
    expect(
      nextGateState(
        { applied: "gated", hangoverS: PLAYBACK_GATE_HANGOVER_S },
        { dtS: SUSPEND_GAP_S, interviewerAudible: false },
      ),
    ).toEqual({
      state: { applied: "resting", hangoverS: 0 },
      effect: "restore",
    });
  });

  it("restores on a suspension gap with hangover still to spare", () => {
    // The gap rule is "parked time is absence" (DECISIONS 011's amnesty
    // philosophy), NOT "the countdown happened to reach zero" — a gate held
    // through a backgrounded tab would tax the candidate's real speech in
    // the room they come back to. Today those two readings are
    // indistinguishable by coincidence: hangoverS is capped at
    // PLAYBACK_GATE_HANGOVER_S, both it and SUSPEND_GAP_S are 2.0, so any
    // gap-sized delta already drives the countdown to zero on its own, and
    // deleting the gap branch changes no reachable behaviour. Both are
    // recorded levers (DECISIONS 074 revisits the hangover if a phantom
    // outlives it), and the moment the hangover is raised past the gap this
    // branch is the only thing that restores. Pinning the rule with
    // hangover left over is what keeps its removal a test failure instead
    // of a silent one.
    expect(
      nextGateState(
        { applied: "gated", hangoverS: SUSPEND_GAP_S * 3 },
        { dtS: SUSPEND_GAP_S, interviewerAudible: false },
      ),
    ).toEqual({
      state: { applied: "resting", hangoverS: 0 },
      effect: "restore",
    });
  });

  it("does nothing while resting and the interviewer is silent", () => {
    expect(
      nextGateState(INITIAL_GATE_STATE, {
        dtS: 0.25,
        interviewerAudible: false,
      }),
    ).toEqual({ state: INITIAL_GATE_STATE, effect: null });
  });
});

describe("formatTimer", () => {
  it("formats zero", () => {
    expect(formatTimer(0)).toBe("00:00");
  });

  it("pads minutes and seconds", () => {
    expect(formatTimer(65)).toBe("01:05");
  });

  it("formats the 20:00 budget", () => {
    expect(formatTimer(SESSION_BUDGET_S)).toBe("20:00");
  });

  it("formats the 25:00 hard cut", () => {
    expect(formatTimer(HARD_CUT_S)).toBe("25:00");
  });

  it("clamps negative input to zero", () => {
    expect(formatTimer(-3)).toBe("00:00");
  });
});

describe("indicatorForEvent", () => {
  it("maps input_audio_buffer.speech_started to the listening indicator", () => {
    const raw = JSON.stringify({ type: "input_audio_buffer.speech_started" });
    expect(indicatorForEvent(raw)).toBe("listening");
  });

  it("ignores every other event type in v0.1", () => {
    const others = [
      "input_audio_buffer.speech_stopped",
      "output_audio_buffer.started",
      "response.done",
      "session.created",
      "error",
    ];
    for (const type of others) {
      expect(indicatorForEvent(JSON.stringify({ type }))).toBeNull();
    }
  });

  it("never throws on malformed data channel payloads", () => {
    expect(indicatorForEvent("not json")).toBeNull();
    expect(indicatorForEvent("")).toBeNull();
    expect(indicatorForEvent("{}")).toBeNull();
  });
});

describe("hard cut", () => {
  it("keeps the contract constants: 20:00 budget, 25:00 hard cut", () => {
    expect(SESSION_BUDGET_S).toBe(1200);
    expect(HARD_CUT_S).toBe(1500);
  });

  it("does not trigger before 1500s", () => {
    expect(isHardCut(0)).toBe(false);
    expect(isHardCut(1499)).toBe(false);
  });

  it("triggers at exactly 1500s and after", () => {
    expect(isHardCut(1500)).toBe(true);
    expect(isHardCut(1501)).toBe(true);
    expect(isHardCut(479, 480)).toBe(false);
    expect(isHardCut(480, 480)).toBe(true);
  });
});

describe("timeStatusCheckpoints", () => {
  it("fires at 75% elapsed and at the wrap-up margin for the 20:00 budget", () => {
    const [threeQ, wrap] = timeStatusCheckpoints();
    expect(threeQ.atS).toBe(900);
    expect(wrap.atS).toBe(1080);
  });

  it("every note carries the [time status] contract marker", () => {
    for (const cp of timeStatusCheckpoints()) {
      expect(cp.text.startsWith(TIME_STATUS_PREFIX)).toBe(true);
    }
  });

  it("names the minutes remaining", () => {
    const [threeQ, wrap] = timeStatusCheckpoints();
    expect(threeQ.text).toContain("About 5 minutes remain");
    expect(wrap.text).toContain("About 2 minutes remain");
  });

  it("drops the steer note when it would land after the closing note", () => {
    // The 5:00 quick budget. The wrap-up margin is a fixed two minutes and
    // the steer point is a fraction, so here the fraction (225s) falls AFTER
    // the margin (180s). Emitted in list order, dueTimeStatus sent the steer
    // note at 225s and then the closing note on the very next 250ms tick —
    // the interviewer told about one minute remaining, then about two.
    const checkpoints = timeStatusCheckpoints(QUICK_SESSION_BUDGET_S);
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0].atS).toBe(180);
    expect(checkpoints[0].text).toBe(
      `${TIME_STATUS_PREFIX} About 2 minutes remain — ask at most one short final question, then close the interview.`,
    );
  });

  it("fires in the order it is listed, at every budget", () => {
    for (const budgetS of [300, 480, 600, 900, SESSION_BUDGET_S, 1800]) {
      const ats = timeStatusCheckpoints(budgetS).map((cp) => cp.atS);
      expect(
        [...ats].sort((a, b) => a - b),
        `checkpoints for a ${budgetS}s budget are out of order: dueTimeStatus walks the list by index, so a later note at an earlier second fires immediately after the one before it`,
      ).toEqual(ats);
    }
  });

  it("makes the number and the verb agree", () => {
    expect(minutesRemaining(60)).toBe("1 minute remains");
    expect(minutesRemaining(90)).toBe("2 minutes remain");
    expect(minutesRemaining(120)).toBe("2 minutes remain");
    expect(minutesRemaining(300)).toBe("5 minutes remain");
  });

  it("agrees with itself about number and verb", () => {
    // These notes are read by the interviewer and spoken from. "About 1
    // minutes remain" is what the 5:00 budget used to produce.
    for (let budgetS = 180; budgetS <= 1800; budgetS += 15) {
      for (const cp of timeStatusCheckpoints(budgetS)) {
        expect(cp.text, `at budget ${budgetS}s`).not.toMatch(/\b1 minutes\b/);
        expect(cp.text, `at budget ${budgetS}s`).not.toMatch(
          /\b(?!1\b)\d+ minute remains\b/,
        );
      }
    }
  });
});

describe("closing behavior", () => {
  const transcriptEvent = (transcript: unknown) => JSON.stringify({
    type: "response.output_audio_transcript.done",
    transcript,
  });

  it("extracts only finished interviewer transcripts", () => {
    expect(finishedTranscriptForEvent(transcriptEvent("Good luck out there."))).toBe("Good luck out there.");
    expect(finishedTranscriptForEvent(transcriptEvent(7))).toBeNull();
    expect(finishedTranscriptForEvent("not json")).toBeNull();
  });

  it("arms only at wrap-up and detects the marker case-insensitively", () => {
    const before = nextSilenceState(INITIAL_SILENCE_STATE, {
      dtS: 0.25, candidateAudible: false, interviewerAudible: false,
      commitArrived: false, elapsedS: 1079, finishedTranscript: CLOSING_MARKER,
    });
    expect(before.state.closingSeen).toBe(false);
    const armed = nextSilenceState(INITIAL_SILENCE_STATE, {
      dtS: 0.25, candidateAudible: false, interviewerAudible: false,
      commitArrived: false, elapsedS: 1080, finishedTranscript: "GOOD LUCK OUT THERE!",
    });
    expect(armed.state.closingSeen).toBe(true);
    const other = nextSilenceState(INITIAL_SILENCE_STATE, {
      dtS: 0.25, candidateAudible: false, interviewerAudible: false,
      commitArrived: false, elapsedS: 1080, finishedTranscript: "Thank you.",
    });
    expect(other.state.closingSeen).toBe(false);
  });

  it("suppresses all responses and cancels pending debounce after closing", () => {
    const result = nextSilenceState({
      ...INITIAL_SILENCE_STATE, closingSeen: true,
      quietS: SILENCE_STAGES[0].at, responseDueInS: 0.1,
    }, { ...QUIET, commitArrived: true });
    expect(result.effects.stage).toBeNull();
    expect(result.effects.triggerResponse).toBe(false);
    expect(result.state.responseDueInS).toBeNull();
  });

  it("ends once after full quiet, with either speaker resetting linger", () => {
    let state = { ...INITIAL_SILENCE_STATE, closingSeen: true };
    let ends = 0;
    for (const tick of quietFor(CLOSING_LINGER_S + 1)) {
      const result = nextSilenceState(state, tick); state = result.state;
      ends += Number(result.effects.endInterview);
    }
    expect(ends).toBe(1);
    const candidate = nextSilenceState({ ...INITIAL_SILENCE_STATE, closingSeen: true, closingQuietS: 1 }, { ...QUIET, candidateAudible: true });
    const interviewer = nextSilenceState({ ...INITIAL_SILENCE_STATE, closingSeen: true, closingQuietS: 1 }, { ...QUIET, interviewerAudible: true });
    expect(candidate.state.closingQuietS).toBe(0);
    expect(interviewer.state.closingQuietS).toBe(0);
  });
});

describe("dueTimeStatus", () => {
  it("is null before the first checkpoint", () => {
    expect(dueTimeStatus(899, 0)).toBeNull();
  });

  it("returns the first checkpoint once reached", () => {
    expect(dueTimeStatus(900, 0)?.atS).toBe(900);
  });

  it("does not re-fire an already-sent checkpoint", () => {
    expect(dueTimeStatus(1000, 1)).toBeNull();
    expect(dueTimeStatus(1080, 1)?.atS).toBe(1080);
  });

  it("is null when every checkpoint is sent", () => {
    expect(dueTimeStatus(1499, 2)).toBeNull();
  });

  it("still fires a checkpoint a delayed tick has passed (throttled tabs)", () => {
    expect(dueTimeStatus(1200, 0)?.atS).toBe(900);
  });
});

describe("greetingTriggerEvent", () => {
  it("builds the response.create nudge that makes Morgan speak first", () => {
    expect(JSON.parse(greetingTriggerEvent())).toEqual({
      type: "response.create",
    });
  });
});

describe("timeStatusEvent", () => {
  it("builds a conversation.item.create system note", () => {
    const parsed = JSON.parse(timeStatusEvent("[time status] test"));
    expect(parsed.type).toBe("conversation.item.create");
    expect(parsed.item.type).toBe("message");
    expect(parsed.item.role).toBe("system");
    expect(parsed.item.content[0]).toEqual({
      type: "input_text",
      text: "[time status] test",
    });
  });
});

const QUIET: SilenceTick = {
  dtS: 0.25,
  candidateAudible: false,
  interviewerAudible: false,
  commitArrived: false,
};

function runTicks(state: SilenceClockState, ticks: SilenceTick[]) {
  const stages: string[] = [];
  let triggers = 0;
  for (const tick of ticks) {
    const r = nextSilenceState(state, tick);
    state = r.state;
    if (r.effects.stage) stages.push(r.effects.stage.text);
    if (r.effects.triggerResponse) triggers += 1;
  }
  return { state, stages, triggers };
}

const quietFor = (s: number) => Array(Math.round(s / 0.25)).fill(QUIET);
const candidateFor = (s: number) =>
  Array(Math.round(s / 0.25)).fill({ ...QUIET, candidateAudible: true });
const interviewerFor = (s: number) =>
  Array(Math.round(s / 0.25)).fill({ ...QUIET, interviewerAudible: true });

describe("silence clock", () => {
  const established = { ...INITIAL_SILENCE_STATE, candidateCommitSeen: true };

  it("fires stage 1 once at 8s of quiet", () => {
    const { stages } = runTicks(established, quietFor(10));
    expect(stages).toEqual([SILENCE_STAGES[0].text]);
    expect(stages[0].startsWith(SILENCE_STATUS_PREFIX)).toBe(true);
  });

  it("escalates through stages 2 and 3, then stops", () => {
    const { stages } = runTicks(established, quietFor(45));
    expect(stages).toEqual(SILENCE_STAGES.map((s) => s.text));
  });

  it("resets on candidate speech of 2s or more", () => {
    const mid = runTicks(established, [
      ...quietFor(6),
      ...candidateFor(STALL_BLIP_MAX_S + 0.5),
    ]);
    expect(mid.state.quietS).toBe(0);
    const after = runTicks(mid.state, quietFor(7.5));
    expect(after.stages).toEqual([]);
  });

  it("stall blips pause but do not reset accumulation", () => {
    const { stages } = runTicks(established, [
      ...quietFor(6),
      ...candidateFor(1),
      ...quietFor(2.5),
    ]);
    expect(stages).toEqual([SILENCE_STAGES[0].text]);
  });

  it("interviewer audio pauses but never resets", () => {
    const { stages } = runTicks(established, [
      ...quietFor(5),
      ...interviewerFor(3),
      ...quietFor(3.5),
    ]);
    expect(stages).toEqual([SILENCE_STAGES[0].text]);
  });

  it("a commit arms a debounced response trigger", () => {
    const { triggers } = runTicks(INITIAL_SILENCE_STATE, [
      { ...QUIET, commitArrived: true },
      ...quietFor(RESPONSE_DEBOUNCE_S + 0.5),
    ]);
    expect(triggers).toBe(1);
  });

  it("candidate sound cancels a pending response", () => {
    const { triggers } = runTicks(INITIAL_SILENCE_STATE, [
      { ...QUIET, commitArrived: true },
      ...quietFor(0.25),
      ...candidateFor(0.5),
      ...quietFor(3),
    ]);
    expect(triggers).toBe(0);
  });

  it("a firing stage supersedes a pending response", () => {
    const { stages, triggers } = runTicks(INITIAL_SILENCE_STATE, [
      ...quietFor(7.5),
      { ...QUIET, commitArrived: true },
      ...quietFor(3),
    ]);
    expect(stages).toEqual([SILENCE_STAGES[0].text]);
    expect(triggers).toBe(0);
  });
});

describe("silence events and wire helpers", () => {
  it("silenceStatusEvent shapes a system note", () => {
    const parsed = JSON.parse(silenceStatusEvent(SILENCE_STAGES[0].text));
    expect(parsed.type).toBe("conversation.item.create");
    expect(parsed.item.role).toBe("system");
    expect(parsed.item.content[0].text).toBe(SILENCE_STAGES[0].text);
  });

  it("responseTriggerEvent is a bare response.create", () => {
    expect(JSON.parse(responseTriggerEvent())).toEqual({
      type: "response.create",
    });
  });

  it("speechStateForEvent maps the three input events and ignores junk", () => {
    const mk = (type: string) => JSON.stringify({ type });
    expect(speechStateForEvent(mk("input_audio_buffer.speech_started"))).toBe(
      "started",
    );
    expect(speechStateForEvent(mk("input_audio_buffer.speech_stopped"))).toBe(
      "stopped",
    );
    expect(speechStateForEvent(mk("input_audio_buffer.committed"))).toBe(
      "committed",
    );
    expect(speechStateForEvent(mk("response.done"))).toBeNull();
    expect(speechStateForEvent("not json")).toBeNull();
  });
});

describe("interviewer lifecycle events (F-06 hotfix — no single-signal dependence)", () => {
  const mk = (type: string) => JSON.stringify({ type });

  it("maps output_audio_buffer lifecycle and response.done", () => {
    expect(interviewerStateForEvent(mk("output_audio_buffer.started"))).toBe(
      "speaking",
    );
    expect(interviewerStateForEvent(mk("output_audio_buffer.stopped"))).toBe(
      "quiet",
    );
    expect(interviewerStateForEvent(mk("output_audio_buffer.cleared"))).toBe(
      "quiet",
    );
    expect(interviewerStateForEvent(mk("response.done"))).toBe(
      "response_done",
    );
    expect(interviewerStateForEvent(mk("input_audio_buffer.speech_started"))).toBeNull();
    expect(interviewerStateForEvent("not json")).toBeNull();
  });
});

describe("echo-turn hygiene helpers", () => {
  it("committedItemId extracts the id only from committed events", () => {
    expect(
      committedItemId(
        JSON.stringify({ type: "input_audio_buffer.committed", item_id: "item_A" }),
      ),
    ).toBe("item_A");
    expect(
      committedItemId(JSON.stringify({ type: "response.done", item_id: "x" })),
    ).toBeNull();
    expect(committedItemId("junk")).toBeNull();
  });

  it("itemDeleteEvent shapes a conversation.item.delete", () => {
    expect(JSON.parse(itemDeleteEvent("item_A"))).toEqual({
      type: "conversation.item.delete",
      item_id: "item_A",
    });
  });
});

// F-66: the room refuses a session that has already ended. Only "planned"
// opens the start card — the same predicate the worker's mint and heartbeat
// guards hold — and every other status, including ones this build has never
// heard of, fails closed into an honest ended notice.
describe("endedRoomNotice", () => {
  it("keeps the room open only for a planned session", () => {
    expect(endedRoomNotice("planned")).toBeNull();
  });

  it("closes the room for every other status, known or not", () => {
    for (const status of [
      "scoring",
      "scored",
      "insufficient",
      "failed",
      "failed_permanent",
      "abandoned",
      "some-future-status",
      "",
    ]) {
      expect(endedRoomNotice(status)).not.toBeNull();
    }
  });

  it("tells both slot-preserving endings that the slot survived", () => {
    // "failed" and "insufficient" are equally retriable and equally
    // slot-preserving (quota.py), and the room is now the screen that says
    // so: leaving "failed" in the default bucket told a customer whose only
    // paid attempt died in scoring nothing about what it cost them.
    for (const status of ["insufficient", "failed"]) {
      const notice = endedRoomNotice(status);
      expect(notice?.detail).toContain("kept your session slot");
      expect(notice?.detail).toContain("home screen");
      expect(notice?.showSessionLink).toBe(false);
    }
  });

  it("offers the session page when a report exists or is on its way", () => {
    expect(endedRoomNotice("scored")?.showSessionLink).toBe(true);
    expect(endedRoomNotice("scoring")?.showSessionLink).toBe(true);
  });

  it("never borrows the connection-lost story", () => {
    for (const status of ["scored", "scoring", "insufficient", "failed"]) {
      const notice = endedRoomNotice(status);
      expect(notice?.headline).not.toContain("Connection");
      expect(notice?.detail).not.toContain("connection");
    }
  });

  it("carries no typographic dashes in any notice", () => {
    for (const status of ["scoring", "scored", "insufficient", "failed"]) {
      const notice = endedRoomNotice(status);
      expect(`${notice?.headline} ${notice?.detail}`).not.toMatch(/[–—]/);
    }
  });
});

describe("unscoredEndingOutcome", () => {
  // The quick interview's whole ending is one complete call: nothing was
  // recorded, so there is no upload to retry and no blob to protect. That
  // makes this one decision the entire failure surface of the funnel's exit.

  it("treats the worker's 202 as done", () => {
    expect(unscoredEndingOutcome(202)).toBe("done");
    expect(unscoredEndingOutcome(200)).toBe("done");
  });

  it("treats 409 as done, because the state the visitor wanted exists", () => {
    // A replayed end, a second tab, or a retry after a lost response: the
    // worker already closed this session. Erroring here would tell someone
    // their finished interview failed.
    expect(unscoredEndingOutcome(409)).toBe("done");
  });

  it("fails on a refusal the visitor can retry past", () => {
    // 429 from the complete limiter, 502 from a restarting worker, 401 from
    // an expired cookie. All different problems, all the same offer: retry,
    // or go on to the pitch page.
    for (const status of [400, 401, 403, 413, 429, 500, 502, 503]) {
      expect(unscoredEndingOutcome(status), `status ${status}`).toBe("failed");
    }
  });

  it("fails when there was no response at all", () => {
    // The hole this helper exists to close. fetch REJECTS when the request
    // never reaches a server — offline, dropped connection, DNS — and the
    // ending had no catch, so the rejection escaped and left the room on
    // "Ending the interview…" with no error, no retry and no way out.
    expect(unscoredEndingOutcome(null)).toBe("failed");
  });

  it("keeps the failure line calm and short", () => {
    expect(UNSCORED_ENDING_FAILURE_MESSAGE).not.toContain("!");
    expect(UNSCORED_ENDING_FAILURE_MESSAGE).not.toMatch(/[–—]/);
    expect(UNSCORED_ENDING_FAILURE_MESSAGE.length).toBeLessThan(160);
    // It never mentions a recording: this room has none.
    expect(UNSCORED_ENDING_FAILURE_MESSAGE.toLowerCase()).not.toContain(
      "recording",
    );
  });
});
