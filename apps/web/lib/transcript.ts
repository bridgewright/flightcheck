// Pure logic behind the session detail screen: transcript turn grouping,
// inline observation placement, and the state machine that decides which of
// the page's honest framings a session gets. JSX-free and free of any
// server-only runtime import (type imports are erased), so vitest exercises
// it directly and the client-side TranscriptView may import it too.
import type {
  ReportEligibility,
  SessionStatus,
  TimestampedObservation,
  TranscriptSegment,
} from "@/lib/types";
import type { SessionProgressEntry } from "@/lib/worker";

/** Consecutive same-speaker segments merged into one spoken turn. */
export interface TranscriptTurn {
  speaker: "interviewer" | "candidate";
  start_s: number;
  end_s: number;
  text: string;
}

export function groupTurns(segments: TranscriptSegment[]): TranscriptTurn[] {
  const ordered = [...segments].sort((a, b) => a.start_s - b.start_s);
  const turns: TranscriptTurn[] = [];
  for (const segment of ordered) {
    const last = turns[turns.length - 1];
    if (last !== undefined && last.speaker === segment.speaker) {
      last.end_s = segment.end_s;
      last.text = `${last.text} ${segment.text}`.trim();
    } else {
      turns.push({
        speaker: segment.speaker,
        start_s: segment.start_s,
        end_s: segment.end_s,
        text: segment.text,
      });
    }
  }
  return turns;
}

export function candidateTurns(segments: TranscriptSegment[]): TranscriptTurn[] {
  return groupTurns(segments).filter((turn) => turn.speaker === "candidate");
}

/** The transcript with delivery observations inlined at their timestamps. */
export type TimelineEntry =
  | { kind: "turn"; turn: TranscriptTurn }
  | { kind: "observation"; observation: TimestampedObservation };

/**
 * Turns and observations interleaved in time order. An observation lands
 * AFTER the turn it happened in (the last turn starting at or before its
 * timestamp) — the reader hears the moment, then reads the note about it.
 * Observations before the first turn, or with no turns at all, simply keep
 * timestamp order.
 */
export function transcriptTimeline(
  segments: TranscriptSegment[],
  observations: TimestampedObservation[],
): TimelineEntry[] {
  const turns = groupTurns(segments);
  const pending = [...observations].sort((a, b) => a.at_s - b.at_s);
  const timeline: TimelineEntry[] = [];
  let next = 0;
  for (let i = 0; i < turns.length; i++) {
    timeline.push({ kind: "turn", turn: turns[i] });
    const cutoff = i + 1 < turns.length ? turns[i + 1].start_s : Infinity;
    while (next < pending.length && pending[next].at_s < cutoff) {
      timeline.push({ kind: "observation", observation: pending[next] });
      next += 1;
    }
  }
  // No turns at all: the observations still have something true to say.
  while (next < pending.length) {
    timeline.push({ kind: "observation", observation: pending[next] });
    next += 1;
  }
  return timeline;
}

/**
 * Which framing the session detail page renders. One value per honest state:
 * - scored / limited: a report exists (limited = 10-15 min evidence banner)
 * - insufficient: attempted, below the evidence floor — no numbers, ever
 * - not_started: a planned slot with nothing behind it yet
 * - scoring: the worker is mid-pipeline (poll; transcript may already exist)
 * - failed: scoring broke; whatever was saved (transcript) is still shown
 */
export type SessionDetailState =
  | "scored"
  | "limited"
  | "insufficient"
  | "not_started"
  | "scoring"
  | "failed"
  // The worker retired the row after the resume/re-score caps: the slot is
  // spent, no report will exist, and the room must not be offered again.
  | "closed";

export function deriveSessionDetailState(session: {
  status: SessionStatus;
  report: { eligibility: ReportEligibility } | null;
}): SessionDetailState {
  switch (session.status) {
    case "planned":
      return "not_started";
    case "scoring":
      return "scoring";
    case "failed":
      return "failed";
    case "insufficient":
      return "insufficient";
    // Quick interviews intentionally produce no transcript or score.
    case "quick_done":
      return "insufficient";
    // An abandoned attempt ended before there was anything to score and
    // kept its slot — the insufficient framing exactly, and the state
    // whose CTA offers the resume door the worker will actually honor.
    case "abandoned":
      return "insufficient";
    case "failed_permanent":
      return "closed";
    case "scored":
      // A scored row without its report yet (replication lag, or an
      // inconsistent row) reads as still scoring — the poll state resolves it.
      if (session.report === null) {
        return "scoring";
      }
      return session.report.eligibility === "limited" ? "limited" : "scored";
  }
}

/**
 * The nearest scored session BEFORE the given index, or null. This is the
 * "vs previous" baseline for a session that is not necessarily the latest —
 * lib/progress.deltaVsPrevious only compares the newest pair.
 */
export function previousScoredEntry(
  entries: SessionProgressEntry[],
  index: number,
): SessionProgressEntry | null {
  let best: SessionProgressEntry | null = null;
  for (const entry of entries) {
    if (
      entry.status === "scored" &&
      entry.index < index &&
      (best === null || entry.index > best.index)
    ) {
      best = entry;
    }
  }
  return best;
}

/** A progress entry's dimension scores as a key->score record — the shape
 * ReportView's optional `previous` prop takes. */
export function dimensionScoreMap(
  entry: SessionProgressEntry,
): Record<string, number> {
  return Object.fromEntries(
    entry.dimension_scores.map((d) => [d.dimension_key, d.score]),
  );
}

/** Statuses the worker's create_session will resume rather than pass over
 * (its RETRIABLE_STATUSES): open rows, in resume-priority order by index. */
const OPEN_STATUSES: ReadonlySet<string> = new Set([
  "planned",
  "failed",
  "insufficient",
  "abandoned",
]);

/**
 * The detail page's one primary action, derived from the session's state:
 * - room: enter THIS session's room. Only for a row the room will open —
 *   which after F-66 means status "planned" (not_started) and nothing else.
 * - resume: run the retriable row again THROUGH the resume action (POST
 *   /api/sessions), which re-arms it to "planned" before entering its room.
 *   A direct room link here used to "work" by accident — it interviewed on
 *   a failed/insufficient row, bypassing resume accounting — and now lands
 *   on the ended screen, so the link shape is a lie the moment it renders.
 *   Offered ONLY when this session is the lowest open row: resume takes
 *   the lowest index, and two open rows coexist whenever a row left
 *   "scoring" after a later one was started.
 * - detail: an older session is the one resume would actually hit; the
 *   door names it and leads to its own page rather than silently entering
 *   its room from here.
 * - start: begin the next session through the generic start flow.
 * - home: nothing to start from here (mid-scoring, the package is spent,
 *   or the progress feed is down and no resume promise would be honest).
 */
export type DetailCta =
  | { kind: "room"; sessionId: string; label: string }
  | { kind: "resume"; label: string }
  | { kind: "detail"; sessionId: string; label: string }
  | { kind: "start"; nextIndex: number; label: string }
  | { kind: "home"; label: string };

export function detailCta(
  state: SessionDetailState,
  sessionId: string,
  nextSessionNumber: number | null,
  entries: SessionProgressEntry[] | null,
): DetailCta {
  switch (state) {
    case "not_started":
      return { kind: "room", sessionId, label: "Start this session" };
    case "failed":
    case "insufficient": {
      if (entries === null) {
        return { kind: "home", label: "Back to home" };
      }
      const open = entries
        .filter((e) => OPEN_STATUSES.has(e.status))
        .sort((a, b) => a.index - b.index);
      const lowest = open[0];
      if (lowest === undefined || lowest.session_id === sessionId) {
        // lowest undefined only if the feed disagrees with the row we are
        // rendering (this session IS open); resume still makes the honest
        // fresh decision server-side, so it stays the offer.
        return { kind: "resume", label: "Run this session again" };
      }
      return {
        kind: "detail",
        sessionId: lowest.session_id,
        label: `Finish session ${lowest.index} first`,
      };
    }
    case "scored":
    case "limited":
      return nextSessionNumber === null
        ? { kind: "home", label: "Back to home" }
        : {
            kind: "start",
            nextIndex: nextSessionNumber,
            label: `Start session ${nextSessionNumber}`,
          };
    case "scoring":
    case "closed":
      return { kind: "home", label: "Back to home" };
  }
}

/**
 * Where the CTA actually goes. A "start" CTA enters the next slot's own room
 * when that row already exists (the worker resumes open slots, so the row IS
 * the next session); a fresh index has no room yet, so the create flow on
 * home takes over.
 */
export function detailCtaHref(
  cta: DetailCta,
  entries: SessionProgressEntry[],
): string {
  switch (cta.kind) {
    case "room":
      return `/sessions/${cta.sessionId}/room`;
    // The page renders a resume CTA as the start-session ACTION, not a
    // link; this href is the exhaustiveness fallback, and home is the only
    // honest destination a bare link could offer.
    case "resume":
      return "/home";
    // The older open session's own page, where ITS resume door lives —
    // never its room, which would refuse or mis-enter.
    case "detail":
      return `/sessions/${cta.sessionId}`;
    case "home":
      return "/home";
    case "start": {
      const next = entries.find((entry) => entry.index === cta.nextIndex);
      return next === undefined ? "/home" : `/sessions/${next.session_id}/room`;
    }
  }
}
