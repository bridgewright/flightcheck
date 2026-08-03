// The magic-link resend gate. Supabase rate-limits OTP sends per address;
// a user hammering "resend" would trip that limit and end up locked out for
// far longer than any cooldown. So the login screen disables resend for a
// short countdown after each send — long enough to be rate-limit friendly,
// short enough that a genuinely lost email is quickly retriable.

export const RESEND_COOLDOWN_S = 30;

// Whole seconds left before resend re-enables, from the send timestamp and
// "now" (both epoch ms). Partial seconds round UP so the label never shows
// "0s" while the button is still disabled; clamped to [0, cooldown] so a
// backwards clock jump cannot produce a countdown longer than the cooldown.
export function remainingCooldown(
  sentAtMs: number,
  nowMs: number,
  cooldownS: number = RESEND_COOLDOWN_S,
): number {
  const elapsedS = (nowMs - sentAtMs) / 1000;
  return Math.min(cooldownS, Math.max(0, Math.ceil(cooldownS - elapsedS)));
}

export function resendLabel(remainingS: number): string {
  return remainingS > 0 ? `Resend in ${remainingS}s` : "Resend link";
}
