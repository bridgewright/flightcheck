import { describe, expect, it } from "vitest";

import {
  RESEND_COOLDOWN_S,
  remainingCooldown,
  resendLabel,
} from "@/lib/resend-cooldown";

// The magic-link resend gate: Supabase rate-limits OTP sends, so the button
// stays disabled for a cooldown after each send instead of letting an
// impatient user burn the rate limit and end up genuinely locked out.

describe("remainingCooldown", () => {
  const sentAt = 1_000_000;
  const at = (elapsedS: number) => sentAt + elapsedS * 1000;

  it("starts at the full cooldown the moment the link is sent", () => {
    expect(remainingCooldown(sentAt, at(0))).toBe(RESEND_COOLDOWN_S);
  });

  it("counts down whole seconds, rounding partial seconds up", () => {
    expect(remainingCooldown(sentAt, at(1))).toBe(RESEND_COOLDOWN_S - 1);
    // 0.4s into the 29th second still shows 1 full second remaining of it.
    expect(remainingCooldown(sentAt, at(RESEND_COOLDOWN_S - 0.4))).toBe(1);
  });

  it("reaches zero exactly at the cooldown boundary and stays there", () => {
    expect(remainingCooldown(sentAt, at(RESEND_COOLDOWN_S))).toBe(0);
    expect(remainingCooldown(sentAt, at(RESEND_COOLDOWN_S + 100))).toBe(0);
  });

  it("never exceeds the cooldown even if the clock jumps backwards", () => {
    expect(remainingCooldown(sentAt, at(-10))).toBe(RESEND_COOLDOWN_S);
  });

  it("pins the cooldown at ~30s (rate-limit friendly)", () => {
    expect(RESEND_COOLDOWN_S).toBe(30);
  });
});

describe("resendLabel", () => {
  it("shows the countdown while the gate is closed", () => {
    expect(resendLabel(12)).toBe("Resend in 12s");
  });

  it("offers the resend once the gate opens", () => {
    expect(resendLabel(0)).toBe("Resend link");
  });
});
