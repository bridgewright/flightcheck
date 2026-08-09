import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  EMPTY_STASH,
  QUICK_FIELD_MAX_CHARS,
  QUICK_STASH_MAX_AGE_S,
  QUICK_STASH_PATH,
  decodeStash,
  encodeStash,
} from "@/app/quick/stash";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");

const ACTION = read("app/quick/actions.ts");
const PAGE = read("app/quick/page.tsx");

describe("the quick stash", () => {
  it("round-trips ordinary input", () => {
    const stash = { company: "Acme", role: "Deployment Strategist" };
    expect(decodeStash(encodeStash(stash))).toEqual(stash);
  });

  it("round-trips input written to break the transport", () => {
    // Each of these has broken a cookie or a JSON payload somewhere: the
    // quote and the backslash break the JSON, the newline and the semicolon
    // break the Set-Cookie header, the percent breaks the decode, and the
    // last two are just somebody's real employer.
    for (const hostile of [
      'Acme", "role": "admin',
      "back\\slash",
      "line\nbreak",
      "semi; colon=value",
      "50% off",
      "Ünïcødé GmbH 東京",
      "🚀 rocket",
      "<script>alert(1)</script>",
    ]) {
      expect(decodeStash(encodeStash({ company: hostile, role: hostile }))).toEqual({
        company: hostile,
        role: hostile,
      });
      // A round trip through our own two functions cannot prove the value
      // survives a Set-Cookie header, because it never builds one. What makes
      // it survive is that the encoding is total: percent-encoding leaves
      // nothing a cookie header treats as structure. Assert that directly,
      // or "round-trips input written to break the transport" is a claim
      // about a transport this test does not use.
      const encoded = encodeStash({ company: hostile, role: hostile });
      expect(encoded, hostile).toMatch(/^[A-Za-z0-9\-_.!~*'()%]*$/);
    }
  });

  it("caps what it hands back, however it got there", () => {
    const long = "x".repeat(5000);
    const decoded = decodeStash(encodeStash({ company: long, role: long }));
    expect(decoded.company).toHaveLength(QUICK_FIELD_MAX_CHARS);
    expect(decoded.role).toHaveLength(QUICK_FIELD_MAX_CHARS);
  });

  it("reads anything else as no stash rather than throwing", () => {
    // The cookie arrives from the client. A public page cannot 500 on it.
    for (const junk of [
      undefined,
      "",
      "%",
      "%zz",
      "not json",
      encodeURIComponent("[]"),
      encodeURIComponent("null"),
      encodeURIComponent('"a string"'),
      encodeURIComponent("{}"),
      encodeURIComponent('{"company":1,"role":2}'),
      encodeURIComponent('{"company":"only"}'),
      encodeURIComponent('{"__proto__":{"company":"x","role":"y"}}'),
    ]) {
      expect(() => decodeStash(junk)).not.toThrow();
      expect(decodeStash(junk)).toEqual(EMPTY_STASH);
    }
  });
});

describe("quick entry", () => {
  it("keeps company and role in a short-lived httpOnly cookie", () => {
    expect(ACTION).toContain("httpOnly: true");
    expect(ACTION).toContain('sameSite: "lax"');
    expect(ACTION).toContain("maxAge: QUICK_STASH_MAX_AGE_S");
    expect(QUICK_STASH_MAX_AGE_S).toBeLessThanOrEqual(15 * 60);
  });

  it("clears the stash at the path it was set with", () => {
    // delete(name) serializes without a Path, expiring a cookie at the
    // default path while this one — Path=/quick — survives the create and
    // pre-fills the form on the visitor's next visit.
    expect(ACTION).toContain("path: QUICK_STASH_PATH");
    expect(ACTION).toContain(
      "store.delete({ name: QUICK_STASH_COOKIE, path: QUICK_STASH_PATH })",
    );
    expect(QUICK_STASH_PATH).toBe("/quick");
  });

  it("never puts the visitor's words in a URL", () => {
    for (const source of [ACTION, PAGE]) {
      expect(source).not.toMatch(/[?&](company|role)=/);
      expect(source).not.toMatch(/searchParams.*\b(company|role)\b/);
    }
    // The only redirect targets the action builds, all of them constant
    // except the session id the worker just minted.
    const targets = [...ACTION.matchAll(/redirect\(([^)]*)\)/g)].map((m) => m[1]);
    expect(targets).not.toHaveLength(0);
    for (const target of targets) {
      expect(target).not.toContain("company");
      expect(target).not.toContain("role");
    }
  });

  it("answers a hostile ?error= with nothing", () => {
    // ERRORS is an object literal, so ERRORS["__proto__"] is Object.prototype
    // — truthy, not a ReactNode, and a render crash on a public page.
    expect(PAGE).toContain("Object.hasOwn(ERRORS, key)");
  });

  it("surfaces only refusals a quick start can actually raise", () => {
    expect(ACTION).toContain('error.code === "quick-cap"');
    expect(ACTION).toContain("error.status === 429");
    // package-locked guards sessions on an unpaid STANDARD package; quick
    // packages skip that check. Copy for it told the visitor to unlock or
    // remove their package before trying the free interview. (The name still
    // appears in a comment on each side saying so — these pin the code.)
    expect(ACTION).not.toContain('error.code === "package-locked"');
    expect(ACTION).not.toContain("error=package-locked");
    expect(PAGE).not.toContain('"package-locked":');
    expect(PAGE.toLowerCase()).not.toContain("remove your current");
  });

  it("states the unscored, ungrounded limits and constrains both fields", () => {
    expect(PAGE).toContain("not scored");
    expect(PAGE).toContain("company and role alone");
    expect(PAGE.match(/maxLength=\{QUICK_FIELD_MAX_CHARS\}/g)).toHaveLength(2);
    expect(PAGE.match(/\brequired\b/g)).toHaveLength(2);
  });
});
