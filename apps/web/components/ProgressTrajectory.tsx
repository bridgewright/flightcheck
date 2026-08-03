import type { TrajectoryCell } from "@/components/progress-view";
import { trajectoryCells } from "@/components/progress-view";
import { VERDICT_LABELS } from "@/lib/report-format";
import type { SessionStatus } from "@/lib/types";
import type { SessionProgressEntry } from "@/lib/worker";

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
        <div aria-hidden="true" className="text-lg font-bold text-neutral-300 dark:text-neutral-700">
          —
        </div>
        <span className="sr-only">Session {cell.index}: not used yet.</span>
      </>
    );
  }
  if (cell.status !== "scored") {
    return (
      <div className="py-1 text-[11px] leading-tight text-neutral-500">
        {STATUS_WORDS[cell.status]}
      </div>
    );
  }
  return (
    <>
      <div className="text-lg font-bold tabular-nums">
        {cell.overall === null ? "—" : cell.overall.toFixed(1)}
      </div>
      <div className="text-[11px] leading-tight text-neutral-600 dark:text-neutral-400">
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
      <h2 className="mb-2.5 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
        Trajectory
      </h2>
      <ol className="flex gap-2 overflow-x-auto pb-1">
        {cells.map((cell) => (
          <li
            key={cell.index}
            className="min-w-[84px] flex-1 rounded-md border border-neutral-200 px-2 py-2.5 text-center dark:border-neutral-800"
          >
            <div className="mb-1 text-[10px] font-semibold tracking-wide text-neutral-500 uppercase">
              S{cell.index}
            </div>
            <CellBody cell={cell} />
          </li>
        ))}
      </ol>
    </section>
  );
}
