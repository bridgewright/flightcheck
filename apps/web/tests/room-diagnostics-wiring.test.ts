import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// F-67/F-68, the wiring half: SessionRoom records the trail the fix will be
// chosen from. Source-scan contract in the house style (mic-recovery
// idiom): what matters is that the breadcrumbs exist at the named moments,
// that the buffer lives outside React state, and that the disclosure costs
// a customer nothing until an operator opens it.

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(join(webRoot, rel), "utf8");

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, before: string) =>
      before + match.slice(before.length).replace(/./g, " "),
    );
}

const sessionRoom = withoutComments(read("components/SessionRoom.tsx"));

describe("the diagnostic buffer stays out of the render loop", () => {
  it("lives in a ref, recorded through the pure module", () => {
    expect(sessionRoom).toMatch(/useRef<DiagEntry\[\]>\(\[\]\)/);
    expect(sessionRoom).toContain("recordDiag(");
  });

  it("stamps entries from the monotonic clock", () => {
    expect(sessionRoom).toMatch(/recordDiag\([^)]*performance\.now\(\)/);
  });
});

describe("F-68 start-sequence breadcrumbs", () => {
  it.each([
    ["start-clicked"],
    ["gum-begin"],
    ["gum-ok"],
    ["gum-fail"],
    ["resume-begin"],
    ["resume-ok"],
    ["resume-timeout"],
    ["recorder-ok"],
    ["recorder-fail"],
    ["mint"],
    ["sdp"],
    ["dc-open"],
    ["greeting-sent"],
  ])("records %s", (tag) => {
    expect(sessionRoom).toContain(`"${tag}"`);
  });

  it("names the DOMException on a getUserMedia failure", () => {
    const failAt = sessionRoom.indexOf('"gum-fail"');
    expect(sessionRoom.slice(failAt, failAt + 120)).toContain("DOMException");
  });
});

describe("F-67 turn-system trail", () => {
  it.each([
    ["cand-start"],
    ["cand-stop"],
    ["commit"],
    ["commit-echo-suppressed"],
    ["echo-corr"],
    ["barge-in"],
    ["response-cancel"],
    ["turn-nudge"],
    ["barge-cut"],
    ["barge-hold"],
    ["morgan-speaking"],
    ["morgan-quiet"],
    ["response-done"],
    ["guard-trip"],
  ])("records %s", (tag) => {
    expect(sessionRoom).toContain(`"${tag}"`);
  });

  it.each([
    ["vad-raise"],
    ["vad-restore"],
    ["vad-ack"],
    ["session-start"],
  ])("records %s", (tag) => {
    expect(sessionRoom).toContain(`"${tag}"`);
  });

  it("records heartbeat failures and only failures — the incident's clearest signal", () => {
    // The 409 heartbeat train was the one unambiguous server-side symptom
    // in the F-66 incident, and the beat used to be fire-and-forget. A
    // healthy beat stays silent on purpose: four beats a minute would
    // evict the turn events the ring exists to keep.
    expect(sessionRoom).toContain('"heartbeat-refused"');
    expect(sessionRoom).toContain('"heartbeat-unreachable"');
    // Since DECISIONS 072 the delivered branch advances the delta cursor,
    // so the guard is a block now — but it still records ONLY the failure.
    expect(sessionRoom).toMatch(
      /if \(!res\.ok\) \{\s*diag\("heartbeat-refused", String\(res\.status\)\);\s*return;\s*\}/,
    );
  });

  it("records which trigger asked for a response, stage or debounce", () => {
    expect(sessionRoom).toMatch(/"response-trigger",\s*"stage"/);
    expect(sessionRoom).toMatch(/"response-trigger",\s*"debounce"/);
  });

  it("records the greeting nudge distinctly from later triggers", () => {
    const greetingAt = sessionRoom.indexOf('"greeting-sent"');
    expect(greetingAt).toBeGreaterThan(-1);
    expect(sessionRoom.indexOf('"response-trigger"')).not.toBe(greetingAt);
  });

  it("samples the raw analyser peak before event audibility is merged", () => {
    const sampleAt = sessionRoom.indexOf("pushLevelSample(");
    const eventMergeAt = sessionRoom.indexOf(
      "interviewerAudible = interviewerAudible || morganEventAudibleRef.current",
    );
    expect(sampleAt).toBeGreaterThan(-1);
    expect(sessionRoom.slice(sampleAt, sampleAt + 180)).toContain(
      "remote: remotePeak",
    );
    expect(sampleAt).toBeLessThan(eventMergeAt);
  });

  it("records one shadow correlation verdict before timing chooses either arm", () => {
    const corrCalls = sessionRoom.match(/echoCorrVerdict\(/g) ?? [];
    expect(corrCalls).toHaveLength(2);
    const corrAt = sessionRoom.indexOf("echoCorrVerdict(");
    const timingAt = sessionRoom.indexOf(
      "if (!echoSuspectRef.current || sinceMorganMs >= ECHO_OUTLIVE_MS)",
    );
    expect(corrAt).toBeLessThan(timingAt);
    expect(sessionRoom).toContain('diag("echo-corr", formatEchoCorrNote(corr))');
  });

  it("uses correlation only through the validated barge-cut decision", () => {
    // DECISIONS 076 gave the module no authority; 081 granted exactly one,
    // NARROWLY — a veto on cutting, evaluated inside bargeCutDecision, where
    // two independent conditions stand beside it. Commit suppression is
    // still timing-owned. That narrowness is walkable in one line here, so
    // this pins the two halves that keep it honest.
    //
    // First: the room never reads a verdict. Acting on one requires reading
    // a field, and the only fields this file may touch are the two it prints
    // into the trail. `corr.verdict` anywhere — in the commit arm, in the
    // ticker, beside the diag — reddens this.
    const verdictReads = sessionRoom.match(/(?<!-)\bcorr\.\w+/g) ?? [];
    expect(verdictReads).toEqual(["corr.r", "corr.n"]);
    // Second: the binding is used nowhere else at all, which catches the
    // consult that passes the whole verdict somewhere new rather than
    // reading a field off it. Six uses: two declarations, the trail note on
    // the commit arm, the barge decision's argument, and the two reads
    // above.
    const bindingUses = sessionRoom.match(/(?<!-)\bcorr\b/g) ?? [];
    expect(bindingUses).toHaveLength(6);
    expect(sessionRoom).toContain("bargeCutDecision({");
  });

  it("weighs the barge on medians, never on means", () => {
    // Both series are short and spiky, and a mean of either is a wrong cut:
    // one loud leak tick hides a real barge-in, one silent tick inside an
    // episode buries it. The statistic is a tested pure function, so a mean
    // cannot be smuggled in either by rewriting it (medianPeak's own test
    // dies) or by inlining a different one here (these pins die).
    expect(sessionRoom).toContain("const bargeMicMedian = medianPeak(barge.micSamples)");
    expect(sessionRoom).toContain("const leakBaselineMedian = medianPeak(leakBaselineRef.current)");
    const evidenceAt = sessionRoom.indexOf("bargeCutDecision({");
    expect(sessionRoom.slice(evidenceAt, evidenceAt + 200)).toContain("bargeMicMedian,");
    expect(sessionRoom.slice(evidenceAt, evidenceAt + 200)).toContain("leakBaselineMedian,");
  });

  it("keeps every cut condition inside the decision function", () => {
    // A second copy of a condition drifts from the first the day one moves,
    // and the trail would go on reporting the reason the copy never
    // consulted. The wiring gathers evidence and obeys `decision.cut`.
    expect(sessionRoom).toContain("if (decision.cut && dcRef.current?.readyState === \"open\")");
    expect(sessionRoom).not.toContain("BARGE_SUSTAIN_MS");
    expect(sessionRoom).not.toContain("BARGE_LEVEL_MULTIPLE");
  });

  it("truncates from this utterance's audio start, at a known item id", () => {
    const truncateAt = sessionRoom.indexOf('type: "conversation.item.truncate"');
    expect(truncateAt).toBeGreaterThan(-1);
    const guardAt = sessionRoom.indexOf("const itemId = assistantItemIdRef.current;");
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(truncateAt);
    expect(sessionRoom.slice(guardAt, truncateAt)).toContain("if (itemId !== null)");
    expect(sessionRoom).toContain(
      "audio_end_ms: Math.round(tickAt - utteranceAudioStartRef.current)",
    );
    // The start ref is re-armed on the interviewer's rising audible edge, so
    // the offset is measured within one utterance and can never go negative.
    const edgeAt = sessionRoom.indexOf(
      "if (interviewerAudible && !wasMorganAudibleRef.current)",
    );
    expect(edgeAt).toBeGreaterThan(-1);
    expect(sessionRoom.slice(edgeAt, edgeAt + 200)).toContain(
      "utteranceAudioStartRef.current = tickAt",
    );
    expect(sessionRoom.slice(edgeAt, edgeAt + 200)).toContain(
      "leakBaselineRef.current = []",
    );
  });

  it("keeps candidate-audible ticks out of the leak baseline and in the barge median", () => {
    // The baseline answers "how loud is this room's leak when only Morgan is
    // talking". A tick with the candidate audible is the thing being
    // measured against it, so counting it there raises the bar with the
    // evidence and the cut can never fire.
    expect(sessionRoom).toContain(
      "if (interviewerAudible && !candidateAudibleRef.current) {",
    );
    const pushAt = sessionRoom.indexOf("leakBaselineRef.current.push(micPeak)");
    expect(pushAt).toBeGreaterThan(-1);
    const bargePushAt = sessionRoom.indexOf("barge.micSamples.push(micPeak)");
    expect(bargePushAt).toBeGreaterThan(-1);
    const bargeGateAt = sessionRoom.lastIndexOf(
      "if (candidateAudibleRef.current && interviewerAudible) {",
      bargePushAt,
    );
    expect(bargeGateAt).toBeGreaterThan(-1);
  });

  it("logs barge-hold once per episode, never per tick", () => {
    // The hold is the ledger DECISIONS 081 verifies against, and a per-tick
    // line would bury the ledger in its own noise. Clearing the ref in the
    // same branch is what makes it once.
    const holdAt = sessionRoom.indexOf('diag("barge-hold"');
    expect(holdAt).toBeGreaterThan(-1);
    expect(sessionRoom.slice(holdAt, holdAt + 120)).toContain(
      "bargeActiveRef.current = null",
    );
    expect(sessionRoom.match(/diag\("barge-hold"/g) ?? []).toHaveLength(1);
    expect(sessionRoom.match(/diag\("barge-cut"/g) ?? []).toHaveLength(1);
  });

  it("reads a cleared event against this client's own cut before crying server truncation", () => {
    // The old comment here claimed any cleared event meant server-side
    // truncation had returned. Client cuts produce the same event, so the
    // watch now tells them apart by adjacency to our last cut.
    const clearedAt = sessionRoom.indexOf('rawEvent.includes("output_audio_buffer.cleared")');
    expect(clearedAt).toBeGreaterThan(-1);
    const watch = sessionRoom.slice(clearedAt, clearedAt + 320);
    expect(watch).toContain("lastBargeCutAtRef.current");
    expect(watch).toContain("unexpected-server-cut");
  });

  it("resets correlation episode state with the session gate state", () => {
    const resetAt = sessionRoom.indexOf(
      "gateStateRef.current = INITIAL_GATE_STATE",
    );
    const resetSlice = sessionRoom.slice(resetAt, resetAt + 180);
    expect(resetSlice).toContain("corrRingRef.current = []");
    expect(resetSlice).toContain("candStartAtMsRef.current = 0");
  });
});

describe("closing auto-end trail", () => {
  it.each([["closing-detected"], ["auto-end"]])("records %s", (tag) => {
    expect(sessionRoom).toContain(`"${tag}"`);
  });

  it("never overwrites a marker-bearing transcript within a tick", () => {
    // Two transcript-done events can land inside one 250 ms tick; the
    // second must not clobber a closing marker the first carried.
    expect(sessionRoom).toMatch(
      /finishedTranscript !== null &&\s*\n\s*!finishedTranscriptRef\.current\s*\n?\s*\?\.toLowerCase\(\)\s*\n?\s*\.includes\(CLOSING_MARKER\)/,
    );
  });
});

describe("the disclosure is honest chrome, silent until opened", () => {
  it("renders through the shared label on the room's surfaces", () => {
    expect(sessionRoom.match(/<DiagTrail /g)?.length ?? 0).toBeGreaterThanOrEqual(
      3,
    );
    expect(sessionRoom).toContain("DIAG_DISCLOSURE_LABEL");
  });

  it("snapshots the trail in the toggle handler, never during render", () => {
    // Refs are off-limits to render (the eslint react-compiler rule is the
    // gate); the handler snapshot is also what the operator wants — reopen
    // to refresh. Exactly one format call, and it sits inside onToggle.
    const formatCalls = sessionRoom.match(/formatDiagTrail\(/g) ?? [];
    expect(formatCalls).toHaveLength(1);
    const toggleAt = sessionRoom.indexOf("onToggle=");
    const formatAt = sessionRoom.indexOf("formatDiagTrail(");
    expect(toggleAt).toBeGreaterThan(-1);
    expect(formatAt).toBeGreaterThan(toggleAt);
    expect(sessionRoom).toMatch(/\{trail !== null && \(/);
  });

  it("pins every data-channel send, including both VAD transitions", () => {
    // Eight existing sends plus cancel, nudge note, nudge trigger, buffer
    // clear, and item truncate.
    const sends = sessionRoom.match(/dc(?:Ref\.current)?\??\.send\(/g) ?? [];
    expect(sends).toHaveLength(13);
    // Counted a second time by the shape that does NOT name the handle,
    // which is what makes the claim in this test's name true rather than a
    // spelling of it. The pin above counts two literal spellings, and this
    // repo's recurring defeat of a counting pin is the alias that walks
    // between them: `const ch = dcRef.current; ch.send(…)` adds a send and
    // leaves the count above at thirteen. Every send in this file goes
    // through a member call, so any handle at all lands in this one. Equal
    // today at thirteen, and it is the stricter of the two: an unrelated
    // `.send(` on
    // some future object reddens this deliberately, so a reader has to
    // look at what was added rather than a number moving on its own.
    const anyHandleSends = sessionRoom.match(/\.send\(/g) ?? [];
    expect(
      anyHandleSends.length,
      "a data-channel send is aliased behind another handle",
    ).toBe(13);
  });
});
