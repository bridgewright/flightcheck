import { describe, expect, it } from "vitest";

import {
  deriveSessionDetailState,
  detailCta,
  detailCtaHref,
  dimensionScoreMap,
  groupTurns,
  previousScoredEntry,
  transcriptTimeline,
} from "./transcript";
import type { TimestampedObservation, TranscriptSegment } from "./types";
import type { SessionProgressEntry } from "./worker";

const seg = (
  start_s: number,
  end_s: number,
  speaker: "interviewer" | "candidate",
  text: string,
): TranscriptSegment => ({ start_s, end_s, speaker, text });

const obs = (at_s: number, note = `note at ${at_s}`): TimestampedObservation => ({
  at_s,
  kind: "pace",
  note,
  conflicts_with_dsp: false,
});

describe("groupTurns", () => {
  it("returns no turns for an empty transcript", () => {
    expect(groupTurns([])).toEqual([]);
  });

  it("keeps alternating speakers as separate turns", () => {
    const turns = groupTurns([
      seg(0, 4, "interviewer", "Tell me about a launch."),
      seg(5, 20, "candidate", "Sure. Last year I shipped…"),
    ]);
    expect(turns).toEqual([
      {
        speaker: "interviewer",
        start_s: 0,
        end_s: 4,
        text: "Tell me about a launch.",
      },
      {
        speaker: "candidate",
        start_s: 5,
        end_s: 20,
        text: "Sure. Last year I shipped…",
      },
    ]);
  });

  it("merges consecutive same-speaker segments into one turn", () => {
    const turns = groupTurns([
      seg(0, 4, "candidate", "So the metric moved"),
      seg(4, 9, "candidate", "by twelve percent."),
      seg(10, 12, "interviewer", "Which metric?"),
    ]);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toEqual({
      speaker: "candidate",
      start_s: 0,
      end_s: 9,
      text: "So the metric moved by twelve percent.",
    });
    expect(turns[1].speaker).toBe("interviewer");
  });

  it("orders turns by start time even when segments arrive shuffled", () => {
    const turns = groupTurns([
      seg(10, 12, "interviewer", "Second."),
      seg(0, 4, "candidate", "First."),
    ]);
    expect(turns.map((t) => t.text)).toEqual(["First.", "Second."]);
  });

  it("does not merge same-speaker segments split by the other speaker", () => {
    const turns = groupTurns([
      seg(0, 4, "candidate", "One."),
      seg(5, 6, "interviewer", "Go on."),
      seg(7, 9, "candidate", "Two."),
    ]);
    expect(turns).toHaveLength(3);
  });
});

describe("transcriptTimeline", () => {
  const segments = [
    seg(0, 4, "interviewer", "Walk me through it."),
    seg(5, 60, "candidate", "It started when…"),
    seg(65, 70, "interviewer", "And the outcome?"),
  ];

  it("is just the turns when there are no observations", () => {
    const timeline = transcriptTimeline(segments, []);
    expect(timeline.map((e) => e.kind)).toEqual(["turn", "turn", "turn"]);
  });

  it("places an observation after the turn that contains its timestamp", () => {
    const timeline = transcriptTimeline(segments, [obs(30)]);
    expect(timeline.map((e) => e.kind)).toEqual([
      "turn",
      "turn",
      "observation",
      "turn",
    ]);
  });

  it("places an observation before every turn that starts after it", () => {
    const timeline = transcriptTimeline(segments, [obs(2)]);
    expect(timeline.map((e) => e.kind)).toEqual([
      "turn",
      "observation",
      "turn",
      "turn",
    ]);
  });

  it("keeps multiple observations in timestamp order", () => {
    const timeline = transcriptTimeline(segments, [obs(90), obs(30), obs(40)]);
    const notes = timeline
      .filter((e) => e.kind === "observation")
      .map((e) => e.observation.at_s);
    expect(notes).toEqual([30, 40, 90]);
    // The one after the last turn trails the list.
    expect(timeline[timeline.length - 1].kind).toBe("observation");
  });

  it("renders observations alone when the transcript is empty", () => {
    const timeline = transcriptTimeline([], [obs(10)]);
    expect(timeline.map((e) => e.kind)).toEqual(["observation"]);
  });
});

describe("deriveSessionDetailState", () => {
  const scored = { eligibility: "scored" as const };
  const limited = { eligibility: "limited" as const };

  it("maps a scored session with a full-evidence report to scored", () => {
    expect(
      deriveSessionDetailState({ status: "scored", report: scored }),
    ).toBe("scored");
  });

  it("maps a scored session with a limited-evidence report to limited", () => {
    expect(
      deriveSessionDetailState({ status: "scored", report: limited }),
    ).toBe("limited");
  });

  it("treats scored-without-report as still scoring (defensive)", () => {
    expect(
      deriveSessionDetailState({ status: "scored", report: null }),
    ).toBe("scoring");
  });

  it("maps scoring, failed, and insufficient through unchanged", () => {
    expect(
      deriveSessionDetailState({ status: "scoring", report: null }),
    ).toBe("scoring");
    expect(
      deriveSessionDetailState({ status: "failed", report: null }),
    ).toBe("failed");
    expect(
      deriveSessionDetailState({ status: "insufficient", report: null }),
    ).toBe("insufficient");
  });

  it("maps a planned session to not_started", () => {
    expect(
      deriveSessionDetailState({ status: "planned", report: null }),
    ).toBe("not_started");
  });

  it("maps an abandoned session like insufficient — slot kept, resumable", () => {
    // The worker's reclaim writes "abandoned", and the progress feed emits
    // such rows, but this switch never modeled them: the page derived
    // undefined and threw on render for any abandoned session reached by
    // URL — which the "Finish session N first" CTA now hands out. An
    // abandoned attempt ended before there was anything to score and kept
    // its slot, which is exactly the insufficient framing, and it makes
    // the page offer the resume door the CTA promises.
    expect(
      deriveSessionDetailState({ status: "abandoned", report: null }),
    ).toBe("insufficient");
  });
});

const entry = (
  index: number,
  status: SessionProgressEntry["status"],
  overall: number | null,
  dimensions: Record<string, number> = {},
): SessionProgressEntry => ({
  session_id: `s${index}`,
  index,
  created_at: null,
  status,
  verdict: null,
  overall,
  dimension_scores: Object.entries(dimensions).map(([dimension_key, score]) => ({
    dimension_key,
    score,
  })),
  wpm_overall: null,
  filler_rate_per_min: null,
  silence: null,
  gaps: [],
});

describe("previousScoredEntry", () => {
  it("returns null when nothing before this session is scored", () => {
    expect(previousScoredEntry([entry(1, "scored", 3.1)], 1)).toBeNull();
    expect(previousScoredEntry([entry(1, "failed", null)], 2)).toBeNull();
  });

  it("returns the nearest scored session before the given index", () => {
    const entries = [
      entry(1, "scored", 2.8),
      entry(2, "failed", null),
      entry(3, "scored", 3.2),
      entry(4, "scored", 3.6),
    ];
    expect(previousScoredEntry(entries, 4)?.index).toBe(3);
    expect(previousScoredEntry(entries, 3)?.index).toBe(1);
    // A failed row between scored ones is skipped, not a dead end.
    expect(previousScoredEntry(entries, 2)?.index).toBe(1);
  });

  it("never returns the session itself or a later one", () => {
    const entries = [entry(1, "scored", 2.8), entry(5, "scored", 4.0)];
    expect(previousScoredEntry(entries, 1)).toBeNull();
    expect(previousScoredEntry(entries, 5)?.index).toBe(1);
  });
});

describe("dimensionScoreMap", () => {
  it("maps dimension keys to their scores", () => {
    expect(
      dimensionScoreMap(entry(1, "scored", 3.0, { structure: 3.5, metrics: 2.5 })),
    ).toEqual({ structure: 3.5, metrics: 2.5 });
  });

  it("is empty for a session without dimension scores", () => {
    expect(dimensionScoreMap(entry(1, "failed", null))).toEqual({});
  });
});

describe("detailCta", () => {
  it("sends an unstarted slot into its own room", () => {
    expect(detailCta("not_started", "s1", 3, [entry(1, "planned", null)])).toEqual({
      kind: "room",
      sessionId: "s1",
      label: "Start this session",
    });
  });

  it("offers to rerun a failed or insufficient session through resume", () => {
    // Not a room link (F-66): the room refuses a session past "planned", so
    // the rerun door must be the resume action — POST /api/sessions re-arms
    // the row to planned and only then enters its room.
    const entries = [entry(1, "scored", 3.2), entry(2, "failed", null)];
    expect(detailCta("failed", "s2", 3, entries)).toEqual({
      kind: "resume",
      label: "Run this session again",
    });
    expect(
      detailCta("insufficient", "s2", 3, [
        entry(1, "scored", 3.2),
        entry(2, "insufficient", null),
      ]),
    ).toEqual({
      kind: "resume",
      label: "Run this session again",
    });
  });

  it("never offers resume when an older session is also open — it lands there", () => {
    // Round-2 finding: the worker's resume takes the LOWEST open row, and
    // two open rows coexist whenever a row left "scoring" after a later
    // one was started. A resume button on the newer session would silently
    // enter the older session's room, with the older session's questions,
    // and burn the older row's resume attempt. The honest door names the
    // session that resume would actually hit.
    const entries = [entry(1, "failed", null), entry(2, "insufficient", null)];
    expect(detailCta("insufficient", "s2", 3, entries)).toEqual({
      kind: "detail",
      sessionId: "s1",
      label: "Finish session 1 first",
    });
    // The older session itself still gets the resume door.
    expect(detailCta("failed", "s1", 3, entries)).toEqual({
      kind: "resume",
      label: "Run this session again",
    });
  });

  it("degrades to home when the progress feed is unavailable", () => {
    // Without entries there is no honest way to know which row resume
    // would land on; home's own CTA resolves the right action server-side.
    expect(detailCta("failed", "s2", 3, null)).toEqual({
      kind: "home",
      label: "Back to home",
    });
  });

  it("points a scored session at starting the next one", () => {
    expect(detailCta("scored", "s3", 4, [entry(3, "scored", 3.0)])).toEqual({
      kind: "start",
      nextIndex: 4,
      label: "Start session 4",
    });
    expect(detailCta("limited", "s3", 4, [entry(3, "scored", 3.0)])).toEqual({
      kind: "start",
      nextIndex: 4,
      label: "Start session 4",
    });
  });

  it("falls back to home when the package is spent", () => {
    expect(detailCta("scored", "s3", null, [entry(3, "scored", 3.0)])).toEqual({
      kind: "home",
      label: "Back to home",
    });
  });

  it("sends a still-scoring session home — there is nothing to start yet", () => {
    expect(detailCta("scoring", "s4", 5, [entry(4, "scoring", null)])).toEqual({
      kind: "home",
      label: "Back to home",
    });
  });
});

describe("detailCtaHref", () => {
  it("links a room CTA to that session's own room", () => {
    expect(
      detailCtaHref(
        { kind: "room", sessionId: "s-2", label: "Start this session" },
        [],
      ),
    ).toBe("/sessions/s-2/room");
  });

  it("links a home CTA to home", () => {
    expect(detailCtaHref({ kind: "home", label: "Back to home" }, [])).toBe(
      "/home",
    );
  });

  it("falls back to home for a resume CTA — the page renders the action instead", () => {
    expect(
      detailCtaHref({ kind: "resume", label: "Run this session again" }, []),
    ).toBe("/home");
  });

  it("links a detail CTA to that session's detail page, not its room", () => {
    expect(
      detailCtaHref(
        { kind: "detail", sessionId: "s1", label: "Finish session 1 first" },
        [],
      ),
    ).toBe("/sessions/s1");
  });

  it("links a start CTA straight into the next slot's room when that row exists", () => {
    // The worker resumes open slots, so "session 2" here IS the existing
    // planned row — entering its room directly matches create_session.
    const entries = [entry(1, "scored", 3.0), entry(2, "failed", null)];
    expect(
      detailCtaHref(
        { kind: "start", nextIndex: 2, label: "Start session 2" },
        entries,
      ),
    ).toBe("/sessions/s2/room");
  });

  it("falls back to home when the next session has no row yet", () => {
    // A fresh index needs the create flow, which lives on home.
    const entries = [entry(1, "scored", 3.0)];
    expect(
      detailCtaHref(
        { kind: "start", nextIndex: 2, label: "Start session 2" },
        entries,
      ),
    ).toBe("/home");
  });
});
