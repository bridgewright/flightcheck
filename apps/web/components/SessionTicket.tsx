import type { ReactNode } from "react";

import type { VerdictLine } from "@/lib/home";

// The one object on the page: what you do next, and the sentence from last
// time that says why. It keeps a ticket's structure — stub, perforation,
// barcode — but stays in the night palette, marked out by elevation rather
// than by being the one bright thing on a dark screen.
const LABEL = "text-[9.5px] font-bold tracking-[.11em] text-faint uppercase";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function Rule({ children, live }: { children: ReactNode; live: boolean }) {
  return (
    <p
      className={`border-l-[3px] py-0.5 pl-3 text-[13.5px] text-muted ${
        live ? "border-amber" : "border-line"
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
  action = null,
}: {
  /** null once every session in the package has been used. */
  sessionNumber: number | null;
  totalSessions: number;
  verdict?: VerdictLine | null;
  action?: ReactNode;
}) {
  const exhausted = sessionNumber === null;
  return (
    <article className="grid grid-cols-[1fr_84px] overflow-hidden rounded-[14px] border border-[#2c3a5e] bg-[linear-gradient(175deg,var(--color-night-2)_0%,#131b33_100%)] shadow-[0_2px_6px_rgba(0,0,0,.35),0_18px_48px_rgba(0,0,0,.45)] sm:grid-cols-[1fr_96px]">
      <div className="flex flex-col gap-3 px-[22px] py-5">
        {exhausted ? (
          <>
            <div>
              <div className={LABEL}>Package complete</div>
              <div className="font-data text-[21px] font-bold">
                {totalSessions} of {totalSessions} used
              </div>
            </div>
            <Rule live={false}>
              All six sessions of this package are used. A new package covers a new
              JD — or the same one again.
            </Rule>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className={LABEL}>Next session</div>
                <div className="font-data text-[21px] font-bold">
                  Session <span className="text-coral">{pad(sessionNumber)}</span>
                </div>
              </div>
              {/* The mockup's third stat read "STATUS / READY", which collides
                  with the readiness verdict this same screen renders as "NOT
                  YET READY". Two meanings of one word, so it is dropped. */}
              <div className="flex gap-[22px] font-data text-[13px]">
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
                <b className="font-semibold text-ink">{verdict.headline}</b>
                {verdict.detail ? ` ${verdict.detail}` : ""}
              </Rule>
            ) : (
              <Rule live={false}>
                No verdict yet. Your first scored session sets the baseline.
              </Rule>
            )}
          </>
        )}
        {action ? (
          <div className="flex flex-wrap items-center gap-3.5">
            {action}
            {exhausted ? null : (
              <span className="text-xs text-faint">
                Fresh topics · English · scored from your voice
              </span>
            )}
          </div>
        ) : null}
      </div>
      <div className="flex flex-col items-center justify-between gap-4 border-l-2 border-dashed border-faint bg-night-1 px-3 py-4">
        <span className={LABEL}>{exhausted ? "Used" : pad(sessionNumber)}</span>
        <span
          aria-hidden="true"
          className="h-9 w-[58px] bg-[repeating-linear-gradient(90deg,var(--color-muted)_0_2px,transparent_2px_5px)] opacity-55"
        />
      </div>
    </article>
  );
}
