// The delivery-trends table's row definitions, JSX-free so vitest pins the
// labels, the order, and every formatting rule directly (the repo has no DOM
// render harness). ProgressDeliveryTable.tsx renders these: a null cell
// becomes the empty-rule dash — missing data is shown as missing, never as
// a zero.
//
// Raw measurements only: no targets, no judgments. The scorer's judges own
// interpretation; these rows are instrumentation the user reads over time.
import { formatLatency } from "@/lib/report-format";
import type { SessionProgressEntry } from "@/lib/worker";

export interface DeliveryRow {
  label: string;
  /** Secondary rows render muted: detail beneath the primary measures. */
  secondary: boolean;
  /** Formatted cell text, or null when the session has nothing to show. */
  cell: (entry: SessionProgressEntry) => string | null;
}

export const DELIVERY_ROWS: DeliveryRow[] = [
  {
    label: "Words per minute",
    secondary: false,
    cell: (entry) =>
      entry.wpm_overall === null ? null : String(Math.round(entry.wpm_overall)),
  },
  {
    label: "Fillers per minute",
    secondary: false,
    cell: (entry) =>
      entry.filler_rate_per_min === null
        ? null
        : entry.filler_rate_per_min.toFixed(1),
  },
  {
    // F-23: same label and format as the report's delivery metrics, so the
    // trend row and the per-session number can never disagree in vocabulary.
    // The `?? null` absorbs entries serialized by workers older than the
    // field — an absent key is missing data, exactly like null.
    label: "Avg response latency",
    secondary: false,
    cell: (entry) => {
      const latency = entry.avg_response_latency_s ?? null;
      return latency === null ? null : formatLatency(latency);
    },
  },
  {
    label: "Silences",
    secondary: true,
    cell: (entry) =>
      entry.silence === null ? null : String(entry.silence.count),
  },
  {
    label: "Longest silence",
    secondary: true,
    cell: (entry) =>
      entry.silence === null ? null : `${entry.silence.longest_s.toFixed(0)}s`,
  },
];
