import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const room = readFileSync(
  fileURLToPath(new URL("../components/SessionRoom.tsx", import.meta.url)),
  "utf-8",
);

/** Source with comments blanked, line count preserved: the house idiom, so a
 * comment that names the identifier a pin counts is not what moves the count. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, before: string) =>
      before + match.slice(before.length).replace(/./g, " "),
    );
}

const emitted = withoutComments(room);

describe("room heartbeat lifecycle", () => {
  it("runs only in the reducer's live phase and cleans up with that phase", () => {
    expect(room).toContain('if (phase !== "live") return;');
    expect(room).toContain("HEARTBEAT_INTERVAL_S * 1000");
    expect(room).toContain("return () => clearInterval(heartbeat);");
  });

  it("sends no package token or alternate liveness opinion", () => {
    expect(room).toContain("`/api/sessions/${sessionId}/heartbeat`");
    expect(room).not.toMatch(/heartbeat[\s\S]{0,300}connectionState/);
  });
});

// Every pin below reads SessionRoom.tsx as TEXT, because the web harness is
// node-only (vitest.config.ts sets environment: "node") and this repo has no
// DOM, no testing-library, and no component-render test anywhere. So these
// pin the shape of the code, not the behaviour of a mounted room: they catch
// a moved assignment, a dropped call site, a lost body, and an alias of the
// symbol they count. What they cannot catch is a rewrite that names none of
// those symbols — a fourth flush that inlines its own fetch to the heartbeat
// route is invisible here. The pure half of the delta logic lives in
// lib/room-diagnostics.ts precisely so that half IS behaviour-tested; what
// stays here is the wiring, which nothing in this harness can execute.
describe("diagnostics delta on the beat (DECISIONS 072)", () => {
  it("takes the delta from the ring against the sent cursor and wires it", () => {
    expect(room).toContain(
      "takeDiagDelta(diagRef.current, diagSentMsRef.current)",
    );
    expect(room).toContain("formatDiagWire(delta)");
  });

  it("attaches a body only when there is something new to carry", () => {
    expect(room).toMatch(/delta\.length > 0\s*\?[\s\S]{0,220}formatDiagWire\(delta\)/);
  });

  it("advances the cursor only on a delivered beat", () => {
    // The refused branch returns BEFORE the cursor assignment, so a failed
    // beat re-carries its delta. Pinned as the exact guard-then-advance
    // sequence, not as two independent substrings.
    expect(room).toMatch(
      /if \(!res\.ok\) \{\s*diag\("heartbeat-refused", String\(res\.status\)\);\s*return;\s*\}\s*diagSentMsRef\.current = sentThroughMs;/,
    );
  });

  it("flushes on both end paths and nowhere else", () => {
    // Exactly three beat() call sites: the live-phase effect, the clean end,
    // and the connection-loss guard. A fourth caller (or a dropped flush)
    // changes this count on purpose.
    //
    // Counted as CALLS, not as lines. The first version of this pin matched
    // /^\s*beat\(\);$/gm, which made the claim in its own name untrue: a
    // fourth caller written `void beat();` or `if (x) beat();` was invisible
    // to it, and a formatter joining two lines would have reddened it for
    // nothing. The lookbehind keeps `heartbeat()` and any `x.beat()` out;
    // `setInterval(beat, …)` passes the reference rather than calling it and
    // is deliberately not a call site.
    expect(emitted.match(/(?<![.\w])beat\(\)/g)).toHaveLength(3);
    // And counted as MENTIONS as well, which is what makes the claim in this
    // test's name true rather than a spelling of it (the b5-t3 lesson, kept
    // by hero-drift.test.ts and route-motion.test.ts the same way). A
    // fourth flush written `const flush = beat; flush();`, `setTimeout(beat,
    // 0)`, or `[beat].forEach((f) => f())` leaves the call count at three and
    // was proved green against that count alone; every one of them adds a
    // mention. Eight: the useCallback, the three calls, the setInterval
    // reference, and the three dependency arrays that carry it.
    const mentions = emitted.match(/(?<![.\w])beat\b/g) ?? [];
    expect(mentions.length, "beat is aliased, deferred, or flushed again").toBe(8);
  });
});
