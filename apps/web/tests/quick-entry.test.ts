import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("quick entry", () => {
  it("keeps company and role in a short-lived httpOnly cookie", () => {
    const source = read("app/quick/actions.ts");
    expect(source).toContain("httpOnly: true");
    expect(source).toContain('sameSite: "lax"');
    expect(source).toContain("maxAge: MAX_AGE_SECONDS");
    expect(source).not.toContain("company=${");
  });

  it("states the unscored, ungrounded limits and constrains both fields", () => {
    const source = read("app/quick/page.tsx");
    expect(source).toContain("not scored");
    expect(source).toContain("company and role alone");
    expect(source.match(/maxLength=\{120\}/g)).toHaveLength(2);
    expect(source.match(/ required /g)).toHaveLength(2);
  });
});
