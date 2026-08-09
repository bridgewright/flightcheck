import type { ReactNode } from "react";

import type { VerdictLine } from "@/lib/home";
import { exhaustedSessionsLine } from "@/lib/home";
// The one object on the page: what you do next, and the sentence from last
// time that says why.
import { CARD, LABEL, SCORE_NUMBER, SUB_HEADING } from "@/lib/ui";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function Rule({ children, live }: { children: ReactNode; live: boolean }) {
  return (
    <p
      className={`border-l-2 py-0.5 pl-3 text-fine text-ink-muted ${
        live
          ? "border-ink"
          : "border-hairline"
      }`}
    >
      {children}
    </p>
  );
}

export default function SessionTicket({
  sessionNumber,
  totalSessions,
  verdict = null,
  stageLine = null,
  action = null,
  locked = false,
}: {
  /** null once every session in the package has been used. */
  sessionNumber: number | null;
  totalSessions: number;
  verdict?: VerdictLine | null;
  /** lib/home.scoringStageLine's sentence while a session is being scored. */
  stageLine?: string | null;
  action?: ReactNode;
  /** lib/home.isUnpaid: an unpaid package's exhausted state is an unlock
   * moment on the SAME package, not the end of it. (The worker grants the
   * trial quota to every unpaid package, so the copy holds beyond the
   * account's first one.) */
  locked?: boolean;
}) {
  const exhausted = sessionNumber === null;
  return (
    <article className={CARD}>
      <div className="flex flex-col gap-3 px-5 py-5">
        {exhausted ? (
          <>
            <div>
              <div className={LABEL}>{locked ? "Package locked" : "Package complete"}</div>
              <div className={`${SCORE_NUMBER} text-section`}>
                {totalSessions} of {totalSessions} used
              </div>
            </div>
            {locked ? (
              <Rule live>
                Your rubric is ready. Unlock the scored sessions to start practicing
                against this job description.
              </Rule>
            ) : (
              <Rule live={false}>
                {exhaustedSessionsLine(totalSessions)} A new package covers a new
                JD, or the same one again.
              </Rule>
            )}
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className={LABEL}>Next session</div>
                <div className={`${SCORE_NUMBER} text-section`}>
                  Session {pad(sessionNumber)}
                </div>
              </div>
              {/* The mockup's third stat read "STATUS / READY", which collides
                  with the readiness verdict this same screen renders as "NOT
                  YET READY". Two meanings of one word, so it is dropped. */}
              <div className="flex gap-6 text-fine tabular-nums">
                <div>
                  <div className={LABEL}>Progress</div>
                  {pad(sessionNumber)} / {pad(totalSessions)}
                </div>
                <div>
                  <div className={LABEL}>Duration</div>20 MIN
                </div>
              </div>
            </div>
            {verdict ? (
              <Rule live>
                Last verdict:{" "}
                <b className={SUB_HEADING}>
                  {verdict.headline}
                </b>
                {verdict.detail ? ` ${verdict.detail}` : ""}
              </Rule>
            ) : (
              <Rule live={false}>
                No verdict yet. Your first scored session sets the baseline.
              </Rule>
            )}
          </>
        )}
        {/* Rendered in the exhausted state too: the final session of a
            package scores after its slot count hits the quota, and that is
            exactly when the user is watching for this line. */}
        {stageLine ? <Rule live>{stageLine}</Rule> : null}
        {action ? (
          <div className="flex flex-wrap items-center gap-3.5">
            {action}
            {exhausted ? null : (
              <span className="text-fine text-ink-faint">
                One bar · English · scored from your voice
              </span>
            )}
          </div>
        ) : null}
      </div>
    </article>
  );
}
