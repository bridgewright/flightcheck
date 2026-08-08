import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("study page gate", () => {
  it("polls only in the generating branch and keeps proxy coverage", () => {
    const page = readFileSync(fileURLToPath(new URL("../app/study/page.tsx", import.meta.url)), "utf8");
    const proxy = readFileSync(fileURLToPath(new URL("../proxy.ts", import.meta.url)), "utf8");
    expect(page.match(/<PollRefresh/g)).toHaveLength(1);
    expect(page.indexOf("<PollRefresh")).toBeGreaterThan(page.indexOf('state === "generating"'));
    expect(proxy).toContain("/study");
  });
});
