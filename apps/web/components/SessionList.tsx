import Link from "next/link";

import { formatSessionDate } from "@/lib/home";
import type { SessionStatus } from "@/lib/types";
import type { SessionSummary } from "@/lib/worker";
import { CHIP, CHIP_ALARM, CHIP_BLUSH, EMPTY_RULE, LABEL, SCORE_NUMBER, TABLE_ROW } from "@/lib/ui";

// A session that is not scored yet still has something true to say about
// itself. "failed" is shown, not hidden: the product's promise is the bar,
// and a session that could not be scored is part of the record.
const PILLS: Record<SessionStatus, { label: string; className: string } | null> = {
  planned: {
    label: "Not started",
    className: CHIP,
  },
  scoring: {
    label: "Scoring…",
    className: CHIP_BLUSH,
  },
  failed: {
    label: "Scoring failed",
    className: CHIP_ALARM,
  },
  insufficient: {
    label: "Not scored: not enough evidence",
    className: CHIP_ALARM,
  },
  failed_permanent: {
    label: "Closed, not scored",
    className: CHIP_ALARM,
  },
  scored: null,
};

function Outcome({ session }: { session: SessionSummary }) {
  const pill = PILLS[session.status];
  if (pill) {
    return (
      <span
        className={pill.className}
      >
        {pill.label}
      </span>
    );
  }
  return session.overall === null ? (
    <span className={EMPTY_RULE} aria-hidden="true" />
  ) : (
    <span className={SCORE_NUMBER}>{session.overall.toFixed(1)}</span>
  );
}

// `token` is accepted but unused: the rows moved from the token report URLs
// to the login-scoped /sessions/[id] routes, and the one remaining caller
// outside this track still passes it. Drop the prop once /p/[token] becomes
// a pure claim/redirect route.
export default function SessionList({
  sessions,
}: {
  sessions: SessionSummary[];
  token?: string;
}) {
  const newestFirst = [...sessions].sort((a, b) => b.index - a.index);
  return (
    <section>
      <h2 className={`${LABEL} mb-2.5`}>
        Your sessions
      </h2>
      {newestFirst.length === 0 ? (
        <p className="text-fine text-ink-muted">
          Nothing here yet. Your first session appears the moment you finish it.
        </p>
      ) : (
        <ul>
          {newestFirst.map((session) => {
            const when = formatSessionDate(session.created_at);
            return (
              // The whole row is the link: the detail page has an honest
              // state for every status, not only scored ones.
              <li key={session.id} className={TABLE_ROW}>
                <Link
                  href={`/sessions/${session.id}`}
                  className="grid grid-cols-[36px_1fr_auto_auto] items-center gap-3.5 py-3 text-fine hover:bg-paper-sunk"
                >
                  <span className="text-fine text-ink-faint tabular-nums">
                    {String(session.index).padStart(2, "0")}
                  </span>
                  <span className="text-ink-muted">
                    {when ?? ""}
                  </span>
                  <Outcome session={session} />
                  {session.report_available ? (
                    <span className="text-fine underline underline-offset-4">
                      Report
                    </span>
                  ) : (
                    <span />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
