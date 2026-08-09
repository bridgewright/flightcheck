// Pure helpers behind the home dashboard and the package page. JSX-free and
// free of any server-only import, so vitest exercises them directly and both
// screens compose the same logic instead of each deriving its own.
import { PACKAGE_SESSIONS, PRICE_DISPLAY } from "@/lib/pricing";
import type {
  PackageStatus,
  SessionReport,
  SessionStatus,
  Verdict,
} from "@/lib/types";

/** The only shape the journey logic needs — the worker's richer session
 * summaries satisfy it structurally. */
export interface JourneySession {
  index: number;
  status: SessionStatus;
}

/** done = the session was attempted · next = where the user is going now ·
 * todo = a slot still owed by the package. */
export type JourneyLeg = "done" | "next" | "todo";

// A session that was started but never scored keeps its slot: the worker's
// create_session resumes a "planned", "failed", "insufficient", or
// "abandoned" row (its RETRIABLE_STATUSES) rather than burning a new one,
// so the strip must point at that slot instead of the one after it.
// "failed_permanent" is deliberately absent: the worker retires a row after
// the resume/re-score caps, and resuming it would only bounce off a 409.
const RESUMABLE: ReadonlySet<SessionStatus> = new Set<SessionStatus>([
  "planned",
  "failed",
  "insufficient",
  "abandoned",
]);

// An attempt the user actually made. "failed" and "insufficient" belong here
// too — the session happened; only the scoring (or the evidence for it)
// did not. "abandoned" likewise: a room only becomes reclaimable after it
// went live and stopped reporting.
const ATTEMPTED: ReadonlySet<SessionStatus> = new Set<SessionStatus>([
  "scoring",
  "scored",
  "failed",
  "insufficient",
  "abandoned",
  "failed_permanent",
]);

// Rows numbered outside the package's own range cannot be drawn on a strip of
// totalSessions legs, and letting one drive "the next index" would hand the
// user a session the package does not owe them.
function withinPackage(
  sessions: JourneySession[],
  totalSessions: number,
): JourneySession[] {
  return sessions.filter(
    (session) =>
      Number.isInteger(session.index) &&
      session.index >= 1 &&
      session.index <= totalSessions,
  );
}

/**
 * The session the user resumes or creates next, or null when the package is
 * spent. Mirrors the worker's create_session semantics: an open slot first,
 * otherwise the index after the highest one used.
 */
export function nextSessionNumber(
  sessions: JourneySession[],
  totalSessions: number,
): number | null {
  const owned = withinPackage(sessions, totalSessions);
  const resumable = owned
    .filter((session) => RESUMABLE.has(session.status))
    .map((session) => session.index);
  if (resumable.length > 0) {
    return Math.min(...resumable);
  }
  const highest = owned.reduce((max, session) => Math.max(max, session.index), 0);
  const next = highest + 1;
  return next <= totalSessions ? next : null;
}

/** One leg per session the package owes, Start on the left, Ready on the right. */
export function journeyLegs(
  sessions: JourneySession[],
  totalSessions: number,
): JourneyLeg[] {
  const owned = withinPackage(sessions, totalSessions);
  const next = nextSessionNumber(owned, totalSessions);
  const attempted = new Set(
    owned.filter((session) => ATTEMPTED.has(session.status)).map((s) => s.index),
  );
  return Array.from({ length: Math.max(totalSessions, 0) }, (_, i) => {
    const index = i + 1;
    if (index === next) {
      return "next";
    }
    return attempted.has(index) ? "done" : "todo";
  });
}

// The dashboard speaks the product's fixed verdict vocabulary. Bare words
// for inline use (package cards), sentence form for the ticket's verdict line.
const VERDICT_WORDS: Record<Verdict, string> = {
  not_ready: "Not yet ready",
  approaching: "Approaching",
  ready: "Ready",
};

/** "Not yet ready" / "Approaching" / "Ready" — the fixed wording, no period. */
export function verdictPhrase(verdict: Verdict): string {
  return VERDICT_WORDS[verdict];
}

const VERDICT_PHRASES: Record<Verdict, string> = {
  not_ready: `${VERDICT_WORDS.not_ready}.`,
  approaching: `${VERDICT_WORDS.approaching}.`,
  ready: `${VERDICT_WORDS.ready}.`,
};

export interface VerdictLine {
  /** The phrase that carries the judgment — emphasized wherever it renders. */
  headline: string;
  /** What the last report found and what this session does about it. */
  detail: string;
  /** The whole sentence, for anywhere without markup. */
  text: string;
}

function humanizeDimensionKey(key: string): string {
  const words = key.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The one line the ticket carries forward from the last report: the verdict,
 * the dimension that is holding the candidate back, and the promise that this
 * session goes after it.
 *
 * The observation stays a fact this code can derive ("the lowest of your 6
 * dimensions"). The judge's own prose is not truncated into it: rationales run
 * 170-190 characters and are written about the candidate in the third person,
 * so a clipped one would either overflow the card or misquote the judge. The
 * full text is one click away in the report.
 */
export function verdictLine(
  report: SessionReport | null,
  dimensionNames: Record<string, string> = {},
): VerdictLine | null {
  if (!report) {
    return null;
  }
  const headline = VERDICT_PHRASES[report.verdict];
  const scores = report.dimension_scores;
  if (scores.length === 0) {
    return { headline, detail: "", text: `Last verdict: ${headline}` };
  }
  const weakest = scores.reduce((low, score) =>
    score.score < low.score ? score : low,
  );
  const name =
    dimensionNames[weakest.dimension_key] ??
    humanizeDimensionKey(weakest.dimension_key);
  const measurement = `${name} ${weakest.score.toFixed(1)}`;
  const detail =
    scores.length > 1
      ? `${measurement}, the lowest of your ${scores.length} dimensions. This session focuses there.`
      : `${measurement}. This session focuses there.`;
  return { headline, detail, text: `Last verdict: ${headline} ${detail}` };
}

/**
 * "Welcome back, tae." from an email, "Welcome back." when there is nothing
 * worth using. The local part is cut at the first dot or digit so an address
 * like thk119914@ greets a person, not an account number.
 */
export function greetingName(email: string | null): string {
  const localPart = (email ?? "").split("@")[0];
  const name = (localPart.match(/^[^.\d]*/)?.[0] ?? "").trim().toLowerCase();
  return name === "" ? "Welcome back." : `Welcome back, ${name}.`;
}

// Absolute, never relative. The session list renders on the server, where
// "Yesterday" is computed in the deployment's timezone and would simply be
// wrong for a user practising at 11 PM on the other side of the world.
const SESSION_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export function formatSessionDate(iso: string | null | undefined): string | null {
  if (!iso) {
    return null;
  }
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : SESSION_DATE_FORMAT.format(at);
}

// --- Navigation ----------------------------------------------------------

/**
 * The cookie GET /switch writes and every cross-package screen reads — the
 * "fc_pkg" hint lib/active-package.resolveActivePackage takes as its cookie
 * argument. One constant so the route and its readers cannot drift.
 */
export const ACTIVE_PACKAGE_COOKIE = "fc_pkg";

export interface NavTab {
  href: "/home" | "/sessions" | "/progress" | "/rubric";
  label: string;
  tour: string;
}

/** The signed-in sections, in display order. */
export const NAV_TABS: readonly NavTab[] = [
  { href: "/home", label: "Home", tour: "nav-home" },
  { href: "/sessions", label: "Sessions", tour: "nav-sessions" },
  { href: "/progress", label: "Progress", tour: "nav-progress" },
  { href: "/rubric", label: "Role & Rubric", tour: "nav-rubric" },
];

/**
 * Which section tab a pathname belongs to, or null when none does. Matching
 * is per path segment ("/sessions/abc" is Sessions; "/sessionsabc" is not),
 * so a section stays underlined on its own detail pages and nowhere else.
 */
export function activeNavTab(
  path: string | null | undefined,
): NavTab["href"] | null {
  if (!path) {
    return null;
  }
  const tab = NAV_TABS.find(
    (candidate) =>
      path === candidate.href || path.startsWith(`${candidate.href}/`),
  );
  return tab?.href ?? null;
}

/**
 * The link a package-switcher entry navigates through: GET /switch validates
 * ownership, sets the active-package cookie, and bounces back to `nextPath`.
 * Both values are user-influenced, so both are encoded.
 */
export function switchHref(packageId: string, nextPath: string): string {
  return `/switch?pkg=${encodeURIComponent(packageId)}&next=${encodeURIComponent(nextPath)}`;
}

// --- Scoring progress ----------------------------------------------------

/** The slice of a session summary the stage line needs — the worker's richer
 * summaries satisfy it structurally. */
export interface StageSession {
  index: number;
  status: SessionStatus;
  scoring_stage: string | null;
}

// Human phrasings of the worker's coarse pipeline stages
// (services/scorer pipeline.py sets these exact tokens). A stage this map
// does not know renders as the generic line — raw internal tokens are not UI
// copy.
const STAGE_PHRASES: Record<string, string> = {
  download: "fetching your recording",
  transcribe: "transcribing your answers",
  "delivery-metrics": "measuring delivery",
  "content-judge": "scoring content",
  "delivery-judge": "scoring delivery",
  compile: "writing your report",
};

/**
 * One sentence about the session currently being scored, or null when none
 * is. The newest scoring session wins if several are in flight.
 */
export function scoringStageLine(sessions: StageSession[]): string | null {
  const scoring = sessions
    .filter((session) => session.status === "scoring")
    .sort((a, b) => b.index - a.index)[0];
  if (!scoring) {
    return null;
  }
  const base = `Session ${String(scoring.index).padStart(2, "0")} is being scored`;
  const phrase =
    scoring.scoring_stage === null
      ? undefined
      : STAGE_PHRASES[scoring.scoring_stage];
  return phrase === undefined ? `${base}.` : `${base}: ${phrase}.`;
}

/**
 * The verdict of the newest session that has one, or null before any does.
 * Sessions without a report carry verdict null, so a newer unscored attempt
 * never hides an older verdict.
 */
export function latestVerdict(
  sessions: { index: number; verdict: Verdict | null }[],
): Verdict | null {
  const latest = sessions
    .filter((session) => session.verdict !== null)
    .sort((a, b) => b.index - a.index)[0];
  return latest?.verdict ?? null;
}

// --- Package cards -------------------------------------------------------

/** What a package is called wherever it is named — the switcher, the cards,
 * the home header. One fallback so "Untitled package" cannot drift. */
export function packageDisplayTitle(roleTitle: string | null): string {
  const title = (roleTitle ?? "").trim();
  return title === "" ? "Untitled package" : title;
}

/**
 * The employer line under a package's title (F-54), or null when there is
 * nothing honest to print.
 *
 * Null and whitespace both mean "the JD never named a company", and a card
 * must render nothing rather than an empty line or a placeholder: two
 * packages for the same role are told apart by this line, and a blank one
 * would say the compiler found nothing when it may simply not have run yet.
 */
export function packageCompanyLine(company: string | null | undefined): string | null {
  const name = (company ?? "").trim();
  return name === "" ? null : name;
}

/** How a pill should read, decided here; how it looks stays in the component. */
export type PillTone = "neutral" | "wait" | "bad" | "done";

export interface PackagePill {
  label: string;
  tone: PillTone;
}

/**
 * The one status word a package card carries. Compile lifecycle first — a
 * package that has no rubric yet (or never will) has nothing to say about
 * session usage. "Ready" is deliberately not a label here: that word is
 * reserved for the readiness verdict.
 */
export function packagePill(
  status: PackageStatus,
  sessionsUsed: number,
  totalSessions: number,
): PackagePill {
  if (status === "compiling") {
    return { label: "Compiling", tone: "wait" };
  }
  if (status === "failed") {
    return { label: "Compile failed", tone: "bad" };
  }
  if (sessionsUsed >= totalSessions) {
    return { label: "Complete", tone: "done" };
  }
  if (sessionsUsed === 0) {
    return { label: "Not started", tone: "neutral" };
  }
  return { label: "In progress", tone: "neutral" };
}

/** The exhausted ticket's first sentence, sized to the package's own quota —
 * packages are not all six sessions. */
export function exhaustedSessionsLine(totalSessions: number): string {
  return `All ${totalSessions} sessions of this package are used.`;
}

// --- Payments (v0.5): effective quota, expiry, receipts ------------------
//
// The trial model: the FIRST package per account starts as a 1-session
// trial; $49 unlocks the SAME package to its full quota. These helpers are
// the single UI chokepoint for that policy — every surface that renders a
// session count or an expiry line derives it here, mirroring the worker's
// quota chokepoint, so the two cannot drift screen by screen.

/** The paid-state slice of a package. PackageSummary and PackageRow both
 * satisfy it structurally; the fields are optional because rows serialized
 * by a pre-v0.5 worker omit them (absence = not trial, unpaid). */
export interface PaywallState {
  kind?: "standard" | "quick";
  is_trial?: boolean;
  paid_at?: string | null;
  /** Comped access (DECISIONS 037): unlocked without an order. */
  comped_at?: string | null;
  expires_at?: string | null;
}

/** A package whose unlock has not been bought yet — the state every unlock
 * CTA and session count keys on. The worker's quota chokepoint grants the
 * trial quota to EVERY unpaid package, not just the account's first one
 * (is_trial marks records and copy, and never flips on payment) — so the
 * UI mirrors paid_at alone, or the two would disagree screen by screen. */
export function isUnpaid(pkg: PaywallState): boolean {
  return !pkg.paid_at;
}

/**
 * Whether the package is unlocked, by either route the worker accepts.
 *
 * This exists because the two questions are not the same one and the screen
 * asks both: "how many sessions does this offer" is about being unlocked,
 * and "should the paywall copy show" is about having been paid for. A comped
 * package (DECISIONS 037) answers yes to the first and no to the second, and
 * the first version of this feature shipped with the web mirroring paid_at
 * alone -- the worker opened six sessions and the screen said "0 of 1".
 */
export function isUnlocked(pkg: PaywallState): boolean {
  return Boolean(pkg.paid_at) || Boolean(pkg.comped_at);
}

/**
 * How many sessions the package offers RIGHT NOW: the trial quota until the
 * package is paid, its own quota afterwards. Every rendered session count
 * goes through here — a "1 of 6" on an unpaid package would promise five
 * sessions the user has not bought.
 */
export function effectiveTotalSessions(
  pkg: PaywallState & { total_sessions: number },
): number {
  if (pkg.kind === "quick") return 1;
  return isUnlocked(pkg) ? pkg.total_sessions : 0;
}

/**
 * The one unlock sentence, derived from lib/pricing so the button can never
 * disagree with the price page.
 *
 * It says "the rest", not "all six". This button renders in exactly one state,
 * trial spent, so at the moment a reader sees it one of the six sessions is
 * already gone. "Unlock all 6 sessions" read as a purchase promise the product
 * would not keep, and it contradicted the sentence directly above it in the
 * same card (SessionTicket: "The rest of this package unlocks with payment")
 * and the landing ("The $49 unlock opens the rest of that same package").
 *
 * The count stays derived rather than dropped, because a reader deciding
 * whether $49 is worth it needs to know how many sessions they are buying.
 */
export function unlockCtaLabel(): string {
  return `Unlock ${PACKAGE_SESSIONS} sessions for ${PRICE_DISPLAY}`;
}

/** Where the unlock CTA sends the user: checkout for this exact package. */
export function checkoutHref(packageId: string): string {
  return `/checkout?pkg=${encodeURIComponent(packageId)}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days until the package expires, rounding partial days up (a window
 * with 25 hours left is honestly "2 days", not a surprise cutoff), or null
 * when no expiry applies: the 30-day window starts at payment, so unpaid
 * packages — trials above all — carry no countdown.
 */
export function expiryRemainingDays(pkg: PaywallState, now: Date): number | null {
  if (!pkg.paid_at || !pkg.expires_at) {
    return null;
  }
  const expiresMs = new Date(pkg.expires_at).getTime();
  if (Number.isNaN(expiresMs)) {
    return null;
  }
  return Math.ceil((expiresMs - now.getTime()) / DAY_MS);
}

/**
 * The remaining-days line for home and package surfaces, or null when no
 * expiry applies. Expiry blocks NEW session starts only — artifacts stay
 * viewable — and the expired line says exactly that.
 */
export function expiryLine(pkg: PaywallState, now: Date): string | null {
  const days = expiryRemainingDays(pkg, now);
  if (days === null) {
    return null;
  }
  if (days <= 0) {
    return "This package has expired. Reports stay available, but new sessions can't start.";
  }
  return days === 1 ? "1 day left on this package." : `${days} days left on this package.`;
}

/**
 * A receipt row's amount: minor units rendered in the order's own currency
 * ("$49.00"), a bare decimal when the worker stored no currency, null when it
 * stored no amount. Never invents a symbol.
 *
 * Null rather than a placeholder character, like formatOrderDate below: the
 * absence is the caller's to draw, and the caller draws it with EMPTY_RULE.
 */
export function formatOrderAmount(
  amountMinor: number | null,
  currency: string | null,
): string | null {
  if (amountMinor === null) {
    return null;
  }
  const amount = amountMinor / 100;
  if (!currency) {
    return amount.toFixed(2);
  }
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency.toUpperCase()}`;
  }
}

// Receipts outlive seasons: unlike the session list's month-day stamp, an
// order row always carries its year.
const ORDER_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function formatOrderDate(iso: string | null): string | null {
  if (!iso) {
    return null;
  }
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : ORDER_DATE_FORMAT.format(at);
}

/** The worker's order status word as UI copy: capitalized, null when absent. */
export function orderStatusLabel(status: string | null): string | null {
  if (!status) {
    return null;
  }
  return status.charAt(0).toUpperCase() + status.slice(1);
}
