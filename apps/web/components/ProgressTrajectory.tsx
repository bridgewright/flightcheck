import { ENTRY_STAGGER_SECONDS } from "@/components/motion/entry";
import Reveal from "@/components/motion/Reveal";
import type { TrajectoryCell } from "@/components/progress-view";
import { trajectoryCells } from "@/components/progress-view";
import { VERDICT_LABELS } from "@/lib/report-format";
import type { SessionStatus } from "@/lib/types";
import type { SessionProgressEntry } from "@/lib/worker";
import { CARD, EMPTY_RULE, LABEL, SCORE_NUMBER } from "@/lib/ui";

// What an unscored column can truthfully say about itself. "failed" and
// "insufficient" are shown, not hidden — an attempt that produced no score
// is part of the record (same stance as SessionList).
const STATUS_WORDS: Record<Exclude<SessionStatus, "scored">, string> = {
  planned: "Not started",
  scoring: "Scoring…",
  failed: "Scoring failed",
  insufficient: "Not scored",
  failed_permanent: "Closed",
};

function CellBody({ cell }: { cell: TrajectoryCell }) {
  if (cell.kind === "empty") {
    return (
      <>
        <span className={EMPTY_RULE} aria-hidden="true" />
        <span className="sr-only">Session {cell.index}: not used yet.</span>
      </>
    );
  }
  if (cell.status !== "scored") {
    return (
      <div className="py-1 text-fine text-ink-faint">
        {STATUS_WORDS[cell.status]}
      </div>
    );
  }
  return (
    <>
      <div className={`${SCORE_NUMBER} text-section`}>
        {cell.overall === null ? (
          <span className={EMPTY_RULE} aria-hidden="true" />
        ) : (
          cell.overall.toFixed(1)
        )}
      </div>
      <div className="text-fine text-ink-muted">
        {cell.verdict === null ? "Scored" : VERDICT_LABELS[cell.verdict]}
      </div>
    </>
  );
}

/** The per-session readiness timeline: one column per session the package
 * owes, verdict word plus overall score where a report exists. */
export default function ProgressTrajectory({
  entries,
  totalSessions,
}: {
  entries: SessionProgressEntry[];
  totalSessions: number;
}) {
  const cells = trajectoryCells(entries, totalSessions);
  if (cells.length === 0) {
    return null;
  }
  return (
    <section>
      <h2 className={`${LABEL} mb-2.5`}>
        Trajectory
      </h2>
      <ol className="flex gap-2 overflow-x-auto pb-1">
        {cells.map((cell, i) => (
          <li key={cell.index} className="min-w-[84px] flex-1">
            {/* The same staggered entry as the landing's how-it-works: the
                cards arrive in session order, and the order is the argument
                (F-58). The Reveal carries the card frame so the card enters,
                not just its text; h-full keeps sibling cards equal height now
                that the frame is one level in. */}
            <Reveal
              className={`${CARD} h-full px-2 py-2.5 text-center`}
              delay={i * ENTRY_STAGGER_SECONDS}
            >
              <div className={`${LABEL} mb-1`}>
                S{cell.index}
              </div>
              <CellBody cell={cell} />
            </Reveal>
          </li>
        ))}
      </ol>
    </section>
  );
}
