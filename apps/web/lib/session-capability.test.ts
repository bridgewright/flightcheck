import { describe, expect, it } from "vitest";

import {
  CAPABILITY_ENDED_MESSAGE,
  sessionCapability,
} from "./session-capability";

const NOW = Date.parse("2026-08-03T12:00:00Z");

describe("sessionCapability", () => {
  it("is active for a session with neither column set", () => {
    // Migration 006 added both columns nullable with no backfill, and
    // docs/architecture.md fixes the reading: null means "not yet", i.e.
    // exactly the behaviour that shipped before the column existed.
    expect(sessionCapability({}, NOW)).toBe("active");
    expect(
      sessionCapability(
        { access_token_expires_at: null, token_revoked_at: null },
        NOW,
      ),
    ).toBe("active");
  });

  it("is active while the expiry is still in the future", () => {
    expect(
      sessionCapability(
        { access_token_expires_at: "2026-08-03T12:00:01Z" },
        NOW,
      ),
    ).toBe("active");
  });

  it("is expired once the expiry has passed", () => {
    expect(
      sessionCapability(
        { access_token_expires_at: "2026-08-03T11:59:59Z" },
        NOW,
      ),
    ).toBe("expired");
  });

  it("is expired exactly at the boundary", () => {
    expect(
      sessionCapability({ access_token_expires_at: "2026-08-03T12:00:00Z" }, NOW),
    ).toBe("expired");
  });

  it("is revoked whenever the revocation column carries anything", () => {
    // Fail closed. A revocation is a security decision already taken; a
    // future-dated or oddly-formatted value is not a reason to keep serving.
    expect(sessionCapability({ token_revoked_at: "2026-08-03T11:00:00Z" }, NOW)).toBe(
      "revoked",
    );
    expect(sessionCapability({ token_revoked_at: "2099-01-01T00:00:00Z" }, NOW)).toBe(
      "revoked",
    );
    expect(sessionCapability({ token_revoked_at: "whenever" }, NOW)).toBe("revoked");
  });

  it("lets revocation win over expiry", () => {
    expect(
      sessionCapability(
        {
          access_token_expires_at: "2026-08-03T11:00:00Z",
          token_revoked_at: "2026-08-03T11:30:00Z",
        },
        NOW,
      ),
    ).toBe("revoked");
  });

  it("treats an unreadable expiry as expired, not as absent", () => {
    // Fail closed again: a value we cannot understand is not permission.
    expect(sessionCapability({ access_token_expires_at: "soon" }, NOW)).toBe(
      "expired",
    );
  });

  it("treats a blank string like a null", () => {
    expect(
      sessionCapability(
        { access_token_expires_at: "  ", token_revoked_at: "" },
        NOW,
      ),
    ).toBe("active");
  });

  it("defaults to the current clock", () => {
    expect(sessionCapability({ access_token_expires_at: "2000-01-01T00:00:00Z" })).toBe(
      "expired",
    );
  });
});

describe("CAPABILITY_ENDED_MESSAGE", () => {
  it("is honest and calm, and does not blame the candidate", () => {
    expect(CAPABILITY_ENDED_MESSAGE).not.toContain("!");
    expect(CAPABILITY_ENDED_MESSAGE.toLowerCase()).toContain("access");
  });
});
