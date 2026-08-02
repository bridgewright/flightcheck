import Link from "next/link";

import { formatSessionDate } from "@/lib/home";
import type { SessionStatus } from "@/lib/types";
import type { SessionSummary } from "@/lib/worker";

// A session that is not scored yet still has something true to say about
// itself. "failed" is shown, not hidden: the product's promise is the bar,
// and a session that could not be scored is part of the record.
const PILLS: Record<SessionStatus, { label: string; className: string } | null> = {
  planned: {
    label: "Not started",
    className: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  },
  scoring: {
    label: "Scoring…",
    className: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  },
  failed: {
    label: "Scoring failed",
    className: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  },
  insufficient: {
    label: "Not scored — not enough evidence",
    className: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  },
  scored: null,
};

function Outcome({ session }: { session: SessionSummary }) {
  const pill = PILLS[session.status];
  if (pill) {
    return (
      <span
        className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium ${pill.className}`}
      >
        {pill.label}
      </span>
    );
  }
  return session.overall === null ? (
    <span className="text-neutral-500">—</span>
  ) : (
    <span className="font-semibold tabular-nums">{session.overall.toFixed(1)}</span>
  );
}

export default function SessionList({
  sessions,
  token,
}: {
  sessions: SessionSummary[];
  token: string;
}) {
  const newestFirst = [...sessions].sort((a, b) => b.index - a.index);
  return (
    <section>
      <h2 className="mb-2.5 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
        Your sessions
      </h2>
      {newestFirst.length === 0 ? (
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Nothing here yet — your first session appears the moment you finish it.
        </p>
      ) : (
        <ul>
          {newestFirst.map((session) => {
            const when = formatSessionDate(session.created_at);
            return (
              <li
                key={session.id}
                className="grid grid-cols-[36px_1fr_auto_auto] items-center gap-3.5 border-b border-neutral-200 py-3 text-sm dark:border-neutral-800"
              >
                <span className="text-xs text-neutral-500 tabular-nums">
                  {String(session.index).padStart(2, "0")}
                </span>
                <span className="text-neutral-600 dark:text-neutral-400">
                  {when ?? ""}
                </span>
                <Outcome session={session} />
                {session.report_available ? (
                  <Link
                    href={`/p/${token}/report/${session.id}`}
                    className="text-xs underline underline-offset-4"
                  >
                    Report
                  </Link>
                ) : (
                  <span />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
