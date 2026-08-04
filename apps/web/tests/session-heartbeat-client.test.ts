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
