// F-67/F-68 instrumentation, the pure half (measure-first by design).
//
// Two defects share one gap: the room cannot say what happened. The first
// real session's greeting moved on with no candidate turn (F-67, a
// recurrence), and a Start click died before anything was minted, leaving
// no trace in any log (F-68, cause unproven). The turn system was not
// casually built — the reducer in session-room.ts is the sole source of
// response.create and is adversarially tested — so a blind fix would be a
// guess. This module records the trail the fix will be chosen from.
//
// The room pushes entries into a plain in-memory ring buffer held in a ref:
// no React state, no re-renders, no timing impact. The trail surfaces
// behind a collapsed details disclosure, formatted for the screen only when
// the operator opens it — and since DECISIONS 072 it also leaves the
// browser, formatted for the wire once per delivered heartbeat and appended
// to the session row. The ring is still the only writer; both formatters
// are pure reads of it.

/** One recorded moment: a monotonic timestamp, a short tag, an optional
 * note (a DOMException name, an HTTP status, a millisecond gap). */
export interface DiagEntry {
  atMs: number;
  tag: string;
  note: string;
}

/** Ring capacity. A 25-minute session at a few events per turn stays well
 * under this; the cap only guards a pathological event storm. */
export const DIAG_CAPACITY = 200;

/** Summary line of the disclosure element. One plain word: honest chrome
 * for a customer, a door for the operator. */
export const DIAG_DISCLOSURE_LABEL = "Diagnostics";

/**
 * Record one entry in place. In-place on purpose: the buffer lives in a
 * ref and is written from data-channel handlers and the start sequence —
 * paths where allocation churn and re-renders are exactly what this
 * instrumentation must not add.
 */
export function recordDiag(
  buffer: DiagEntry[],
  atMs: number,
  tag: string,
  note = "",
): void {
  buffer.push({ atMs, tag, note });
  if (buffer.length > DIAG_CAPACITY) {
    buffer.splice(0, buffer.length - DIAG_CAPACITY);
  }
}

/**
 * The trail as readable lines: seconds since the FIRST retained entry, tag,
 * note. Relative time on purpose — the operator lines this up against a
 * screen recording, not against a wall clock.
 */
export function formatDiagTrail(buffer: DiagEntry[]): string {
  if (buffer.length === 0) return "";
  const t0 = buffer[0].atMs;
  return buffer
    .map((entry) => {
      const seconds = ((entry.atMs - t0) / 1000).toFixed(1);
      return `${seconds}s ${entry.tag}${entry.note === "" ? "" : ` ${entry.note}`}`;
    })
    .join("\n");
}

/**
 * Wire format for persisted deltas (DECISIONS 072): absolute monotonic
 * milliseconds, so slices appended server-side across many heartbeats keep
 * one clock. The on-screen formatter above stays slice-relative on purpose
 * — it always renders the whole retained buffer against a screen recording.
 */
export function formatDiagWire(entries: DiagEntry[]): string {
  return entries
    .map(
      (entry) =>
        `${Math.round(entry.atMs)}ms ${entry.tag}${entry.note === "" ? "" : ` ${entry.note}`}`,
    )
    .join("\n");
}

/**
 * Entries recorded after `sinceMs` — the heartbeat's delta. The caller
 * advances its cursor to the last returned entry's atMs only on a DELIVERED
 * beat, so a refused or unreachable one re-carries the same delta next
 * time. Entries the ring trims before they were ever sent are gone by
 * design: the cap guards a pathological event storm, and a storm's tail is
 * its diagnostic part.
 */
export function takeDiagDelta(buffer: DiagEntry[], sinceMs: number): DiagEntry[] {
  return buffer.filter((entry) => entry.atMs > sinceMs);
}
