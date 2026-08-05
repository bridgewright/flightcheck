import Link from "next/link";

import { ENTRY_STAGGER_SECONDS } from "@/components/motion/entry";
import Reveal from "@/components/motion/Reveal";
import { formatSessionDate } from "@/lib/home";
import { archiveStatusPill } from "@/lib/report-format";
import type { SessionSummary } from "@/lib/worker";
import { EMPTY_RULE, LABEL, SCORE_NUMBER, TABLE_ROW } from "@/lib/ui";

// A session that is not scored yet still has something true to say about
// itself. "failed" is shown, not hidden: the product's promise is the bar, and
// a session that could not be scored is part of the record.
//
// The table lives in lib/report-format.ts. There was a second copy here, and
// the two had already drifted: a `planned` session read "Not started" in this
// list and "Not started, slot preserved" on the detail page, so the same
// session described itself differently depending on which screen the reader
// was on.
//
// ProgressTrajectory keeps a third, deliberately shorter set ("Not started",
// "Closed") because its cells are one column of a scrolling strip and the long
// forms do not fit. That is a real constraint rather than drift, and it is
// recorded here so the next person does not consolidate it by reflex.

function Outcome({ session }: { session: SessionSummary }) {
  const pill = archiveStatusPill(session.status);
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
          {newestFirst.map((session, i) => {
            const when = formatSessionDate(session.created_at);
            return (
              // The whole row is the link: the detail page has an honest
              // state for every status, not only scored ones.
              <li key={session.id} className={TABLE_ROW}>
                {/* Rows rise in list order, the same staggered entry as the
                    landing's steps (F-58). The row border stays on the li:
                    the chrome holds still while the record arrives. */}
                <Reveal delay={i * ENTRY_STAGGER_SECONDS}>
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
                </Reveal>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
