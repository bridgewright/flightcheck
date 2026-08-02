import Link from "next/link";

import { formatSessionDate } from "@/lib/home";
import type { SessionStatus } from "@/lib/types";
import type { SessionSummary } from "@/lib/worker";

// A session that is not scored yet still has something true to say about
// itself. "failed" is shown, not hidden: the product's promise is the bar,
// and a session that could not be scored is part of the record.
const PILLS: Record<SessionStatus, { label: string; className: string } | null> = {
  planned: { label: "Not started", className: "bg-faint/15 text-muted" },
  scoring: { label: "Scoring…", className: "bg-amber/15 text-amber" },
  failed: { label: "Scoring failed", className: "bg-coral/15 text-coral" },
  scored: null,
};

function Outcome({ session }: { session: SessionSummary }) {
  const pill = PILLS[session.status];
  if (pill) {
    return (
      <span
        className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${pill.className}`}
      >
        {pill.label}
      </span>
    );
  }
  return session.overall === null ? (
    <span className="font-data text-faint">—</span>
  ) : (
    <span className="font-data font-semibold text-amber">
      {session.overall.toFixed(1)}
    </span>
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
      <h2 className="mb-2.5 text-[11.5px] font-bold tracking-[.1em] text-faint uppercase">
        Your sessions
      </h2>
      {newestFirst.length === 0 ? (
        <p className="text-[13.5px] text-muted">
          Nothing here yet — your first session appears the moment you finish it.
        </p>
      ) : (
        <ul>
          {newestFirst.map((session) => {
            const when = formatSessionDate(session.created_at);
            return (
              <li
                key={session.id}
                className="grid grid-cols-[36px_1fr_auto_auto] items-center gap-3.5 border-b border-line py-3 text-[13.5px]"
              >
                <span className="font-data text-xs text-faint">
                  {String(session.index).padStart(2, "0")}
                </span>
                <span className="text-muted">{when ?? ""}</span>
                <Outcome session={session} />
                {session.report_available ? (
                  <Link
                    href={`/p/${token}/report/${session.id}`}
                    className="border-b border-coral/45 text-[12.5px] text-coral"
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
