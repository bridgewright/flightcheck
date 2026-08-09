import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("quick room wiring", () => {
  it("uses quick timing and an unscored report destination", () => {
    const page = read("app/sessions/[id]/room/page.tsx");
    for (const pin of ["QUICK_SESSION_BUDGET_S", "QUICK_HARD_CUT_S", "unscored: true", "donePath:"]) {
      expect(page).toContain(pin);
    }
  });

  it("does not construct or upload a recording in unscored mode", () => {
    const room = read("components/SessionRoom.tsx");
    expect(room).toContain("if (unscored)");
    expect(room.indexOf("if (unscored)")).toBeLessThan(room.indexOf("new MediaRecorder"));
    expect(room).toContain('body: JSON.stringify({ action: "complete" })');
    expect(room).toContain("router.push(donePath)");
  });
});
