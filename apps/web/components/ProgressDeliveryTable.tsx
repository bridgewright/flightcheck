import type { SessionProgressEntry } from "@/lib/worker";

// Raw measurements only — no targets, no judgments. The scorer's judges own
// interpretation; this table is instrumentation the user reads over time.
// avg response latency is not part of the progress feed (it stays on the
// session detail), so it deliberately has no row here.

function dash(): React.ReactNode {
  return <span className="text-neutral-400 dark:text-neutral-600">—</span>;
}

interface DeliveryRow {
  label: string;
  secondary: boolean;
  value: (entry: SessionProgressEntry) => React.ReactNode;
}

const ROWS: DeliveryRow[] = [
  {
    label: "Words per minute",
    secondary: false,
    value: (entry) =>
      entry.wpm_overall === null ? dash() : Math.round(entry.wpm_overall),
  },
  {
    label: "Fillers per minute",
    secondary: false,
    value: (entry) =>
      entry.filler_rate_per_min === null
        ? dash()
        : entry.filler_rate_per_min.toFixed(1),
  },
  {
    label: "Silences",
    secondary: true,
    value: (entry) => (entry.silence === null ? dash() : entry.silence.count),
  },
  {
    label: "Longest silence",
    secondary: true,
    value: (entry) =>
      entry.silence === null ? dash() : `${entry.silence.longest_s.toFixed(0)}s`,
  },
];

/** How the delivery measurements moved session to session: pace and fillers
 * first, silence detail in muted secondary rows. */
export default function ProgressDeliveryTable({
  scored,
}: {
  scored: SessionProgressEntry[];
}) {
  if (scored.length === 0) {
    return null;
  }
  return (
    <section>
      <h2 className="mb-2.5 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
        Delivery trends
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-xs text-neutral-500 dark:border-neutral-800">
              <th scope="col" className="py-2 pr-3 text-left font-medium">
                Measure
              </th>
              {scored.map((entry) => (
                <th
                  key={entry.session_id}
                  scope="col"
                  className="py-2 pl-3 text-right font-medium"
                >
                  S{entry.index}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr
                key={row.label}
                className={`border-b border-neutral-200 dark:border-neutral-800 ${
                  row.secondary ? "text-neutral-500" : ""
                }`}
              >
                <th scope="row" className="py-2.5 pr-3 text-left font-normal">
                  {row.label}
                </th>
                {scored.map((entry) => (
                  <td
                    key={entry.session_id}
                    className="py-2.5 pl-3 text-right tabular-nums"
                  >
                    {row.value(entry)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
