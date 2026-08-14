import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const room = readFileSync(
  fileURLToPath(new URL("../components/SessionRoom.tsx", import.meta.url)),
  "utf-8",
);

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
    // Exactly three bare beat() call sites: the live-phase effect, the
    // clean end, and the connection-loss guard. A fourth caller (or a
    // dropped flush) changes this count on purpose.
    expect(room.match(/^\s*beat\(\);$/gm)).toHaveLength(3);
  });
});
