// Pure helpers behind the home dashboard and the package page. JSX-free and
// free of any server-only import, so vitest exercises them directly and both
// screens compose the same logic instead of each deriving its own.
import type { SessionReport, SessionStatus, Verdict } from "@/lib/types";

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
// create_session resumes a "planned" or "failed" row rather than burning a
// new one, so the strip must point at that slot instead of the one after it.
const RESUMABLE: ReadonlySet<SessionStatus> = new Set<SessionStatus>([
  "planned",
  "failed",
]);

// An attempt the user actually made. "failed" belongs here too — the session
// happened, only the scoring of it did not.
const ATTEMPTED: ReadonlySet<SessionStatus> = new Set<SessionStatus>([
  "scoring",
  "scored",
  "failed",
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

// The gauge caption and the ticket both speak in the mockup's plain words
// rather than lib/report-format's VERDICT_LABELS, which phrase the same
// verdicts for the report page ("Not ready yet").
const VERDICT_PHRASES: Record<Verdict, string> = {
  not_ready: "Not yet ready.",
  approaching: "Approaching.",
  ready: "Ready.",
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
      ? `${measurement} — the lowest of your ${scores.length} dimensions. This session focuses there.`
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
