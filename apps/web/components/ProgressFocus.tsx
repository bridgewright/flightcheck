import type { DimensionMeta } from "@/components/progress-view";
import {
  gapRecurrenceCount,
  humanizeDimensionKey,
  trailingBottomTwoStreak,
} from "@/components/progress-view";
import type { RecurringIssues } from "@/lib/progress";
import type { SessionProgressEntry } from "@/lib/worker";
import { LABEL, MUTED } from "@/lib/ui";

// Every sentence here states what the data computed and nothing more:
// lib/progress.recurringIssues flags a dimension after two consecutive
// scored sessions in the bottom two, and a gap after two reports carrying
// the same wording. Those rules are the copy — no invented thresholds.

function weakDimensionLine(
  entries: SessionProgressEntry[],
  key: string,
  meta: Record<string, DimensionMeta>,
): string {
  const name = meta[key]?.name ?? humanizeDimensionKey(key);
  const streak = trailingBottomTwoStreak(entries, key);
  if (streak >= 2) {
    return `${name} has been among your two lowest dimensions for your last ${streak} scored sessions.`;
  }
  // recurringIssues flagged an earlier streak that the latest scored session
  // broke — say that, never that it is still running.
  return `${name} was among your two lowest dimensions in consecutive earlier sessions.`;
}

/** The recurring-issues register: dimensions that stay low, and gaps the
 * reports keep repeating. */
export default function ProgressFocus({
  entries,
  issues,
  meta,
}: {
  entries: SessionProgressEntry[];
  issues: RecurringIssues;
  meta: Record<string, DimensionMeta>;
}) {
  const empty = issues.weakDimensions.length === 0 && issues.gaps.length === 0;
  return (
    <section>
      <h2 className={`${LABEL} mb-2.5`}>
        Recurring focus
      </h2>
      {empty ? (
        <p className={`text-fine ${MUTED}`}>
          Nothing recurring yet. This section fills in when the same gap shows
          up in two or more reports, or a dimension stays among your two lowest
          across consecutive scored sessions.
        </p>
      ) : (
        <div className="flex flex-col gap-4 text-fine">
          {issues.weakDimensions.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {issues.weakDimensions.map((key) => (
                <li key={key}>{weakDimensionLine(entries, key, meta)}</li>
              ))}
            </ul>
          ) : null}
          {issues.gaps.length > 0 ? (
            <div>
              <p className={`mb-1.5 ${MUTED}`}>
                Noted in more than one report:
              </p>
              <ul className="flex flex-col gap-1.5">
                {issues.gaps.map((gap) => (
                  <li key={gap} className="border-l-2 border-hairline pl-3">
                    {gap}{" "}
                    <span className="whitespace-nowrap text-ink-faint">
                      ({gapRecurrenceCount(entries, gap)} reports)
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
