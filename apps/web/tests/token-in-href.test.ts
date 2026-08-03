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

// The same capability, leaking a different way. A signed-in screen that
// passes `token={...access_token}` to a client component serializes that
// string into the page's RSC payload — readable in the HTML, in the browser
// cache, and in anything that saves the page. The token-claim flow still
// needs the prop; the signed-in flow does not, because /api/sessions proves
// ownership against the account when no token is sent. Found by the v0.6
// review after F-12 had already closed the room's copy of this leak.
describe("signed-in screens do not ship a capability into the client payload", () => {
  const SIGNED_IN = ["home/page.tsx", "progress/page.tsx", "rubric/page.tsx"];

  it("passes no access_token prop to StartSessionButton", () => {
    const offenders = SIGNED_IN.flatMap((relative) =>
      readFileSync(join(appDir, relative), "utf8")
        .split("\n")
        .map((line, i) => ({ file: relative, line: line.trim(), number: i + 1 }))
        .filter(({ line }) => /token=\{[^}]*access_token/.test(line)),
    );
    expect(offenders).toEqual([]);
  });

  it("keeps the prop optional so the token-claim flow still compiles", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../components/StartSessionButton.tsx", import.meta.url)),
      "utf8",
    );
    expect(source).toMatch(/token\?:\s*string/);
  });
});
