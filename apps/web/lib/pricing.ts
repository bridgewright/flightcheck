// The commercial policy constants (v0.5, user-confirmed): $49 USD unlocks the
// trial package to 6 sessions for 30 days from payment; the first package per
// account starts as a 1-session trial. Every surface that mentions price,
// session counts, or the expiry window reads from here — pricing page,
// checkout, legal terms, expiry copy — so the policy can never drift between
// pages. The scorer mirrors PACKAGE_SESSIONS/EXPIRY_DAYS in
// services/scorer/src/scorer/api/db.py (PAID_TOTAL_SESSIONS/EXPIRY_DAYS).

export const PRICE_USD = 49;
export const PRICE_DISPLAY = "$49";
export const PACKAGE_SESSIONS = 6;
export const TRIAL_SESSIONS = 1;
export const EXPIRY_DAYS = 30;
