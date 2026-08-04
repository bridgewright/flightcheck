import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Source-scan contract for the two account actions on /settings (no render
// harness — same pattern as token-in-href.test.ts). Behaviour lives in
// lib/account.test.ts and tests/account-delete-route.test.ts; what this file
// stops is the SCREEN quietly regressing to a shape that lies.
//
// v0.6 replaced the v0.5 mailto intake with real self-serve deletion (F-34)
// and added the email change (F-35). The mailto survives as the fallback for
// the two honest partial states — no address on record to confirm against,
// and a sign-in record the admin API would not remove.

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

/** Source with every run of whitespace collapsed, so a copy assertion does
 * not fail because a sentence happened to wrap across two JSX lines. */
function squish(source: string): string {
  return source.replace(/\s+/g, " ");
}

const page = read("../app/settings/page.tsx");
const deleteSection = read("../app/settings/delete-account.tsx");

describe("settings screen composition", () => {
  it("has the Delete account & data section", () => {
    expect(page).toContain("Delete account");
    expect(page).toContain("DeleteAccountSection");
  });

  it("offers no way to change the sign-in address", () => {
    // DECISIONS 036: the address belongs to the Google account now. A form
    // here would change the row and not the credential.
    expect(page).not.toContain("EmailChangeSection");
    expect(page).not.toContain("Change sign-in email");
  });

  it("keeps the support mailto as the fallback path", () => {
    expect(page).toContain("deletionMailto");
  });
});

describe("deletion confirmation", () => {
  it("confirms by typing the account address, not a browser dialog", () => {
    expect(deleteSection).toContain("deletionConfirmationMatches");
    expect(squish(deleteSection)).toContain("to confirm");
    // Native confirm()/alert() are forbidden in this codebase: they
    // interrupt instead of informing, and a reflex OK proves nothing.
    expect(deleteSection).not.toMatch(/(^|[^.\w])confirm\(/);
    expect(deleteSection).not.toMatch(/(^|[^.\w])alert\(/);
  });

  it("states that the deletion is immediate and cannot be undone", () => {
    expect(squish(deleteSection)).toContain("immediately and permanently");
    expect(squish(deleteSection)).toContain("no undo and no grace period");
  });

  it("lists what is deleted from the shared source, not a retyped list", () => {
    // The list is the promise. Retyping it here is how it drifts from what
    // the worker actually removes.
    expect(deleteSection).toContain("ACCOUNT_DELETION_REMOVES");
  });

  it("posts to an action path instead of DELETE-with-a-body", () => {
    // Same reasoning Phase 0 used for the worker endpoint: a DELETE
    // carrying a body is accepted unevenly by proxies and clients, and the
    // typed confirmation is the customer's own address, which has no
    // business in a URL that access logs keep.
    expect(deleteSection).toContain('"/api/account/delete"');
    expect(deleteSection).toContain('method: "POST"');
  });

  it("leaves the signed-in surface with a full navigation, not a router push", () => {
    // Every cached RSC payload in this tab describes an account that no
    // longer exists; a client-side push would render one of them.
    expect(deleteSection).toContain("window.location.assign");
    expect(deleteSection).not.toContain("router.push");
  });

  it("says so when only the sign-in record survived", () => {
    expect(deleteSection).toContain("signInRecordRemoved");
    expect(squish(deleteSection)).toContain("Your data is deleted");
  });
});

describe("settings copy register", () => {
  it("carries no exclamation marks anywhere on the screen", () => {
    // A "!" following a word character is an exclamatory sentence; the
    // negations and strict comparisons TypeScript needs never look like it.
    for (const source of [page, deleteSection]) {
      expect(source).not.toMatch(/\w!/);
    }
  });
});
