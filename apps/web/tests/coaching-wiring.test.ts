import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import TranscriptView from "@/components/TranscriptView";
import CoachingDialog from "@/components/CoachingDialog";
import type { SessionCoaching, TranscriptSegment } from "@/lib/types";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("session coaching wiring", () => {
  it("fetches coaching additively and confines tabs to report states", () => {
    const page = read("app/sessions/[id]/page.tsx");
    expect(page).toContain("getSessionCoaching(id).catch(() => null)");
    expect(page.indexOf("const tabs")).toBeGreaterThan(page.indexOf('state === "scored" || state === "limited"'));
  });

  it("authorizes viewer before calling the worker", () => {
    const actions = read("app/sessions/[id]/actions.ts");
    expect(actions.indexOf("getViewer()")).toBeLessThan(actions.indexOf("setParaphraseMark(sessionId"));
    expect(actions.indexOf("authorizeViewerSession")).toBeLessThan(actions.indexOf("setParaphraseMark(sessionId"));
  });

  it("keeps mark state above the dialog subtree", () => {
    const transcript = read("components/TranscriptView.tsx");
    const dialog = read("components/CoachingDialog.tsx");

    expect(transcript).toMatch(/useState<ParaphraseMarks>\([^\n]*coaching\?\.marks/);
    expect(transcript).toContain("mark={markFor(marks, entry.candidateOrdinal)}");
    expect(transcript).not.toContain("markFor(coaching?.marks, entry.candidateOrdinal)");
    expect(dialog).not.toMatch(/useState\([^)]*(?:mark|initial)/i);
    expect(dialog).toContain("mark: ParaphraseMark");
    expect(dialog).toContain("onMarkChange:");
    expect(dialog).not.toContain("markFor(coaching?.marks");
  });

  it("reconciles marks with the server response and rolls back on throw", () => {
    const transcript = read("components/TranscriptView.tsx");

    expect(transcript).toContain("setMarks(await marksAction(ordinal, next))");
    expect(transcript).toMatch(/catch\s*{\s*\n?\s*setMarks\(previous\)/);
  });
});

// The additive guarantee, checked by rendering rather than by reading the
// source. A source scan pins the one line it quotes; this pins the property
// the line exists for -- that turning coaching on changes nothing about how
// the candidate's own words are marked up.
const SEGMENTS: TranscriptSegment[] = [
  { start_s: 0, end_s: 1.5, speaker: "interviewer", text: "Walk me through it." },
  { start_s: 2, end_s: 6, speaker: "candidate", text: "I led the launch and it grew revenue." },
];

const TURN_TEXT = "I led the launch and it grew revenue.";

function coachingDoc(turnCount: number): SessionCoaching {
  return {
    session_id: "s-1",
    paraphrases: {
      schema_version: 1,
      generated_at: "2026-08-05T00:00:00Z",
      turn_count: turnCount,
      items: [{
        turn_index: 0,
        verdict: "improve",
        source_quote: "grew revenue",
        suggestion: "I led the launch, and it grew revenue 12 percent in two quarters.",
        why: "Puts the number in the main clause.",
      }],
    },
    insights: null,
    marks: { schema_version: 1, marks: {} },
  };
}

function render(coaching?: SessionCoaching | null): string {
  return renderToStaticMarkup(createElement(TranscriptView, {
    segments: SEGMENTS,
    observations: [],
    audioUrl: null,
    audioCaption: "Your recording from this session.",
    coaching,
  }));
}

function renderDialog(coaching = coachingDoc(1)): string {
  return renderToStaticMarkup(createElement(CoachingDialog, {
    open: true,
    onClose: () => {},
    item: coaching.paraphrases!.items[0],
    turn: { speaker: "candidate", start_s: 2, end_s: 6, text: TURN_TEXT },
    mark: { reaction: null, bookmarked: false },
    onMarkChange: async () => {},
  }));
}

describe("TranscriptView stays additive", () => {
  const withoutCoaching = render();

  it("renders identically whether coaching is absent or null", () => {
    expect(render(null)).toBe(withoutCoaching);
  });

  it("renders identically when the turn counts drift apart", () => {
    // The cross-language tripwire: the scorer counted a different number of
    // candidate turns than the web just grouped, so no item can be trusted
    // to belong to the turn it names. Nothing attaches.
    expect(render(coachingDoc(99))).toBe(withoutCoaching);
  });

  it("leaves the candidate's own words byte-identical when coaching attaches", () => {
    const withCoaching = render(coachingDoc(1));
    expect(withCoaching).not.toBe(withoutCoaching);      // something was added

    // The exact element carrying the transcribed words is unchanged.
    const turnNode = withoutCoaching.match(/<p class="[^"]*">I led the launch and it grew revenue\.<\/p>/);
    expect(turnNode).not.toBeNull();
    expect(withCoaching).toContain(turnNode![0]);

    // And the words appear exactly once: the suggestion never replaces or
    // duplicates the transcript.
    expect(withCoaching.split(TURN_TEXT)).toHaveLength(2);
  });

  it("renders the coaching chip as a button below the candidate bubble", () => {
    const withCoaching = render(coachingDoc(1));
    expect(withoutCoaching).not.toContain("Suggested phrasings appear under your answers");
    expect(withCoaching).toContain("Suggested phrasings appear under your answers");
    expect(withCoaching).toMatch(/<\/div><button type="button"[^>]*>! Needs work<\/button>/);
  });

  it("hides the anchor rather than printing a quote the turn never contained in the dialog", () => {
    const fabricated = coachingDoc(1);
    fabricated.paraphrases!.items[0].source_quote = "a phrase nobody said";
    const dialog = renderDialog(fabricated);

    expect(dialog).toContain("grew revenue 12 percent in two quarters");
    expect(dialog).not.toContain("a phrase nobody said");
  });

  it("marks the improve verdict and the good verdict differently", () => {
    const improve = render(coachingDoc(1));
    const good = coachingDoc(1);
    good.paraphrases!.items[0].verdict = "good";

    expect(improve).toContain("Needs work");
    expect(improve).not.toContain("✓ Needs work");
    expect(render(good)).toContain("✓ Well said");
  });

  it("does not render a chip for a short answer", () => {
    const short = [{ ...SEGMENTS[0] }, { ...SEGMENTS[1], text: "Too short" }];
    const markup = renderToStaticMarkup(createElement(TranscriptView, {
      segments: short, observations: [], audioUrl: null, audioCaption: "Recording", coaching: coachingDoc(1),
    }));
    expect(markup).not.toContain("Needs work");
    expect(markup).not.toContain("Well said");
  });

  it("orders dialog content as suggestion, why, then verbatim quote", () => {
    const dialog = renderDialog();
    expect(dialog.indexOf("grew revenue 12 percent in two quarters")).toBeLessThan(dialog.indexOf("Puts the number"));
    expect(dialog.indexOf("Puts the number")).toBeLessThan(dialog.indexOf("grew revenue</blockquote>"));
  });
});
