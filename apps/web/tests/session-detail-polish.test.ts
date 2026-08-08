import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { deriveSessionDetailState, detailCta } from "@/lib/transcript";
import { SKELETON } from "@/lib/ui";

// F-43 internal half: the session-detail loading skeleton, the icon pass, and
// the removal of the dead guard_ended branch.
//
// Behaviour where there is behaviour; a source scan for the rest, matching
// token-in-href.test.ts. What these pin is not aesthetics — it is that the
// icons stay re-pointable by the F-21 design pass and that the removed state
// does not creep back in.

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

const page = read("../app/sessions/[id]/page.tsx");
const loading = read("../app/sessions/[id]/loading.tsx");
const transcript = read("../lib/transcript.ts");

describe("the dead guard_ended branch is gone", () => {
  it("leaves no trace in the state machine or the screen", () => {
    // Nothing in the product ever navigated to ?ended=guard: the connection
    // guard sets the room's own "connection-lost" phase and stays there with
    // a retry button. The state was a leftover from an earlier design where
    // the room redirected out, and it rendered copy no user could reach.
    expect(transcript).not.toContain("guard_ended");
    expect(page).not.toContain("guard_ended");
    // This used to ban `searchParams` outright, which worked only while the
    // page had no query state of its own. F-73 gave it one -- the
    // report/transcript/study tabs -- so the ban now forbids a legitimate
    // feature instead of the dead branch. Narrowed to the thing it was
    // always about: the `ended` param that branch read.
    expect(page).not.toMatch(/\bended\b\s*[:=]/);
    expect(page).not.toContain("ended=guard");
  });

  it("derives a planned session as not_started from the row alone", () => {
    expect(deriveSessionDetailState({ status: "planned", report: null })).toBe(
      "not_started",
    );
    expect(deriveSessionDetailState.length).toBe(1);
  });

  it("still sends an unstarted slot into its own room", () => {
    expect(detailCta("not_started", "s-1", 3, null)).toEqual({
      kind: "room",
      sessionId: "s-1",
      label: "Start this session",
    });
  });
});

describe("session-detail loading skeleton", () => {
  it("follows the same skeleton conventions as the other loading files", () => {
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain("sr-only");
    // The pulse used to be a literal `animate-pulse` in this file. F-21 moved
    // it into the SKELETON token, so asserting the literal here would now be
    // asserting that this screen ignores the design system. The property is
    // still pinned, one level down: this file reaches for the token, and the
    // token still carries the pulse and a radius.
    expect(loading).toContain("SKELETON");
    expect(SKELETON).toContain("animate-pulse");
    expect(SKELETON).toMatch(/\brounded-/);
  });

  it("draws the report anatomy, not the archive table it used to inherit", () => {
    // The nearest ancestor was app/sessions/loading.tsx, a row of table bars,
    // which is the wrong shape here and made the swap to content jump.
    // Was `max-w-2xl`, a literal that stopped matching the page it stands in
    // for the moment Shell's width table moved. Both now compose MAIN_READING,
    // which is the property this line was always about: the same column as the
    // report, so the swap to content cannot jump.
    expect(loading).toContain("MAIN_READING");
    // Four or more skeleton blocks: context line, verdict, dimensions,
    // delivery, transcript. Counting token usages rather than radius literals
    // survives a change to what the token's radius happens to be.
    expect(loading.match(/\$\{SKELETON\}/g)?.length ?? 0).toBeGreaterThan(3);
  });
});

describe("the icon pass survives the F-21 design pass", () => {
  it("draws every icon in currentColor with no colour baked in", () => {
    // The whole point: F-21 re-points type colour and the icons follow. An
    // icon with its own stroke colour would have to be re-authored.
    expect(page).toContain('stroke="currentColor"');
    expect(page).toContain('fill="none"');
    expect(page).not.toMatch(/(stroke|fill)="#[0-9a-fA-F]/);
  });

  it("keeps the icons decorative so a screen reader ignores them", () => {
    // The heading next to each icon carries the meaning; announcing the
    // glyph as well would just be noise.
    const icons = page.match(/<svg[\s\S]*?>/g) ?? [];
    expect(icons.length).toBeGreaterThan(0);
    for (const svg of icons) expect(svg).toContain('aria-hidden="true"');
  });

  it("adds no new dependency to draw them", () => {
    const packageJson = read("../package.json");
    expect(packageJson).not.toContain("lucide");
    expect(packageJson).not.toContain("react-icons");
    expect(packageJson).not.toContain("heroicons");
  });
});
