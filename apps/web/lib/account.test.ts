import { describe, expect, it } from "vitest";

import {
  ACCOUNT_DELETION_REMOVES,
  deletionConfirmationMatches,
  emailChangeOutcome,
  validateNewEmail,
} from "@/lib/account";

// The two settings actions a customer can take that they cannot take back.
// Both hinge on wording that is true rather than reassuring, so the wording
// is under test alongside the logic.

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

describe("validateNewEmail", () => {
  it("accepts a different, plausible address and trims it", () => {
    expect(validateNewEmail("old@example.com", "  new@example.com ")).toEqual({
      ok: true,
      email: "new@example.com",
    });
  });

  it("keeps the local part's case — the mailbox owner decides that", () => {
    expect(validateNewEmail("old@example.com", "New.Person@example.com")).toEqual({
      ok: true,
      email: "New.Person@example.com",
    });
  });

  it("refuses an empty address", () => {
    const result = validateNewEmail("old@example.com", "   ");
    expect(result.ok).toBe(false);
  });

  it("refuses something that is not an address", () => {
    for (const bad of ["nope", "no@domain", "two @spaces.com", "@example.com", "a@.com"]) {
      expect(validateNewEmail("old@example.com", bad).ok).toBe(false);
    }
  });

  it("refuses the address already in use for sign-in, case-insensitively", () => {
    const result = validateNewEmail("old@example.com", "OLD@example.com");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("already");
  });

  it("accepts a first address when none is on record", () => {
    expect(validateNewEmail(null, "new@example.com")).toEqual({
      ok: true,
      email: "new@example.com",
    });
  });
});

describe("emailChangeOutcome", () => {
  const current = "old@example.com";
  const requested = "new@example.com";

  it("reports the confirmation round trip rather than a success", () => {
    const outcome = emailChangeOutcome(current, requested, null);
    expect(outcome.kind).toBe("pending");
    // The new address is NOT the sign-in address yet. Saying "email
    // changed" here would be a lie the user discovers at the next login.
    expect(outcome.message).toContain(requested);
    expect(outcome.message).toContain(current);
    expect(outcome.message.toLowerCase()).toContain("until you open");
  });

  it("says the sign-in address is unchanged even with no address on record", () => {
    const outcome = emailChangeOutcome(null, requested, { status: undefined });
    expect(outcome.kind).toBe("pending");
    expect(outcome.message).toContain(requested);
  });

  it("gives an in-use address the SAME answer as an available one", () => {
    // Anything else turns this box into an account-existence oracle for
    // every address on the internet.
    const available = emailChangeOutcome(current, requested, null);
    for (const conflict of [
      { status: 422, code: "email_exists", message: "Email address already registered" },
      { code: "user_already_exists" },
      { status: 400, message: "A user with this email address has already been registered" },
    ]) {
      const taken = emailChangeOutcome(current, requested, conflict);
      expect(taken).toEqual(available);
    }
  });

  it("stays honest about a rate limit instead of pretending a link was sent", () => {
    const outcome = emailChangeOutcome(current, requested, {
      status: 429,
      code: "over_email_send_rate_limit",
    });
    expect(outcome.kind).toBe("error");
    expect(outcome.message.toLowerCase()).toContain("wait");
  });

  it("reports an unexpected failure calmly and without a status code", () => {
    const outcome = emailChangeOutcome(current, requested, {
      status: 500,
      message: "boom",
    });
    expect(outcome.kind).toBe("error");
    expect(outcome.message).not.toContain("500");
    expect(outcome.message).not.toContain("boom");
  });

  it("never carries an exclamation mark", () => {
    const messages = [
      emailChangeOutcome(current, requested, null).message,
      emailChangeOutcome(current, requested, { status: 429 }).message,
      emailChangeOutcome(current, requested, { status: 500 }).message,
    ];
    for (const message of messages) expect(message).not.toContain("!");
  });
});
