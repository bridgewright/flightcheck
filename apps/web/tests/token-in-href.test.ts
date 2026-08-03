import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// A package access token is a capability: whoever holds the string can start
// and complete sessions on that package. Putting one in an href hands it to
// the browser history, the Referer header of every outbound click, and any
// screenshot of the address bar — and unlike the id-scoped start flow, which
// posts the token in a request body, an href leaks it to nothing that needed
// it. The screens have no render harness (environment: node, no jsdom), so
// this scans their source instead: it is the only test that would catch the
// leak coming back.

const appDir = fileURLToPath(new URL("../app", import.meta.url));

function tsxFiles(): string[] {
  return readdirSync(appDir, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".tsx"))
    .map((entry) => join(appDir, entry));
}

describe("access tokens never appear in a link target", () => {
  it("finds no href carrying an access_token in any app screen", () => {
    const offenders = tsxFiles().flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .map((line, i) => ({ file, line, number: i + 1 }))
        .filter(({ line }) => line.includes("href") && line.includes("access_token"))
        .map(({ file: f, number }) => `${f}:${number}`),
    );
    expect(offenders).toEqual([]);
  });
});
