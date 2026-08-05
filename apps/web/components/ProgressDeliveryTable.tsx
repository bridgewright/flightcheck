import { DELIVERY_ROWS } from "@/components/progress-delivery";
import type { SessionProgressEntry } from "@/lib/worker";
import { EMPTY_RULE, LABEL, TABLE_ROW } from "@/lib/ui";

// Raw measurements only — no targets, no judgments. The scorer's judges own
// interpretation; this table is instrumentation the user reads over time.
// Row definitions and every formatting rule live in progress-delivery.ts
// (JSX-free) so vitest pins them; this file only draws the table.

function dash(): React.ReactNode {
  return <span className={EMPTY_RULE} aria-hidden="true" />;
}

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
      <h2 className={`${LABEL} mb-2.5`}>
        Delivery trends
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-fine">
          <thead>
            <tr className={`border-b border-hairline ${LABEL}`}>
              <th scope="col" className="py-2 pr-3 text-left">
                Measure
              </th>
              {scored.map((entry) => (
                <th
                  key={entry.session_id}
                  scope="col"
                  className="py-2 pl-3 text-right"
                >
                  S{entry.index}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DELIVERY_ROWS.map((row) => (
              <tr
                key={row.label}
                className={`${TABLE_ROW} ${
                  row.secondary ? "text-ink-faint" : ""
                }`}
              >
                <th scope="row" className="py-2.5 pr-3 text-left">
                  {row.label}
                </th>
                {scored.map((entry) => {
                  const cell = row.cell(entry);
                  return (
                    <td
                      key={entry.session_id}
                      className="py-2.5 pl-3 text-right tabular-nums"
                    >
                      {cell === null ? dash() : cell}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
