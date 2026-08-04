import { describe, expect, it } from "vitest";

import {
  ACCOUNT_DELETION_REMOVES,
  deletionConfirmationMatches,
} from "@/lib/account";

// The one settings action a customer can take that they cannot take back. It
// hinges on wording that is true rather than reassuring, so the wording is
// under test alongside the logic.

describe("deletionConfirmationMatches", () => {
  it("accepts the account address typed exactly", () => {
    expect(deletionConfirmationMatches("person@example.com", "person@example.com")).toBe(
      true,
    );
  });

  it("accepts it regardless of case and surrounding whitespace", () => {
    // Autofill and mobile keyboards capitalise; refusing that would only
    // make people retype, not make them more certain.
    expect(deletionConfirmationMatches("person@example.com", " Person@Example.COM ")).toBe(
      true,
    );
  });

  it("refuses a different address", () => {
    expect(deletionConfirmationMatches("person@example.com", "someone@example.com")).toBe(
      false,
    );
  });

  it("refuses an empty confirmation", () => {
    expect(deletionConfirmationMatches("person@example.com", "")).toBe(false);
    expect(deletionConfirmationMatches("person@example.com", "   ")).toBe(false);
  });

  it("refuses everything when the account has no email on record", () => {
    // No address means no way to confirm, so the button must never arm --
    // an empty-string match would arm it on an empty box.
    expect(deletionConfirmationMatches(null, "")).toBe(false);
    expect(deletionConfirmationMatches(null, "anything@example.com")).toBe(false);
    expect(deletionConfirmationMatches("", "")).toBe(false);
  });
});

describe("ACCOUNT_DELETION_REMOVES", () => {
  it("names every artifact the worker actually deletes", () => {
    // The copy is the promise. api/deletion.py removes packages, sessions
    // (reports and transcripts are columns on them) and orders, plus the
    // recordings-bucket objects. If that list grows, this list grows.
    const text = ACCOUNT_DELETION_REMOVES.join(" ").toLowerCase();
    for (const artifact of ["recording", "transcript", "report", "session", "order"]) {
      expect(text).toContain(artifact);
    }
  });
});
