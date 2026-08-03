import type { ReactNode } from "react";

import type { VerdictLine } from "@/lib/home";
import { exhaustedSessionsLine } from "@/lib/home";
// The one object on the page: what you do next, and the sentence from last
// time that says why.
import { LABEL } from "@/lib/ui";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function Rule({ children, live }: { children: ReactNode; live: boolean }) {
  return (
    <p
      className={`border-l-2 py-0.5 pl-3 text-sm text-neutral-600 dark:text-neutral-400 ${
        live
          ? "border-neutral-900 dark:border-neutral-100"
          : "border-neutral-300 dark:border-neutral-700"
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
  trial = false,
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
  trial?: boolean;
}) {
  const exhausted = sessionNumber === null;
  return (
    <article className="rounded-md border border-neutral-300 dark:border-neutral-700">
      <div className="flex flex-col gap-3 px-5 py-5">
        {exhausted ? (
          <>
            <div>
              <div className={LABEL}>{trial ? "Trial complete" : "Package complete"}</div>
              <div className="text-xl font-bold tabular-nums">
                {totalSessions} of {totalSessions} used
              </div>
            </div>
            {trial ? (
              <Rule live>
                Your trial session is used. The rest of this package — same JD,
                same rubric, fresh topics — unlocks with payment.
              </Rule>
            ) : (
              <Rule live={false}>
                {exhaustedSessionsLine(totalSessions)} A new package covers a new
                JD — or the same one again.
              </Rule>
            )}
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className={LABEL}>Next session</div>
                <div className="text-xl font-bold tabular-nums">
                  Session {pad(sessionNumber)}
                </div>
              </div>
              {/* The mockup's third stat read "STATUS / READY", which collides
                  with the readiness verdict this same screen renders as "NOT
                  YET READY". Two meanings of one word, so it is dropped. */}
              <div className="flex gap-6 text-sm tabular-nums">
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
                <b className="font-semibold text-neutral-900 dark:text-neutral-100">
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
              <span className="text-xs text-neutral-500">
                Fresh topics · English · scored from your voice
              </span>
            )}
          </div>
        ) : null}
      </div>
    </article>
  );
}
