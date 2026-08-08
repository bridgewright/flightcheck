import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const PLANNER = fileURLToPath(new URL("../../../services/scorer/src/scorer/sessionplan/planner.py", import.meta.url));
const SESSION_ROOM = fileURLToPath(new URL("../lib/session-room.ts", import.meta.url));

function required(source: string, pattern: RegExp, name: string): string {
  const match = pattern.exec(source);
  if (!match) throw new Error(`${name} stopped matching its source — the closing-line SSOT gate stopped guarding it`);
  return match[1];
}

describe("closing line single source", () => {
  it("keeps the web marker inside the planner closing line", () => {
    const planner = readFileSync(PLANNER, "utf-8");
    const room = readFileSync(SESSION_ROOM, "utf-8");
    const source = required(planner, /_CLOSING_LINE\s*=\s*\(\s*([\s\S]*?)\s*\)/, "_CLOSING_LINE");
    const closing = [...source.matchAll(/"([^"]*)"/g)].map((match) => match[1]).join("");
    const marker = required(room, /CLOSING_MARKER\s*=\s*"([^"]+)"/, "CLOSING_MARKER");
    expect(closing.toLowerCase()).toContain(marker);
  });
});
