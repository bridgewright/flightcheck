"use client";

import { useRef } from "react";

import { DspConflictBadge } from "@/components/ReportView";
import { formatTimestamp } from "@/lib/report-format";
import { transcriptTimeline } from "@/lib/transcript";
import type { TimestampedObservation, TranscriptSegment } from "@/lib/types";

// The session transcript with the judge's delivery observations inlined at
// their timestamps, plus the recording itself in a sticky native <audio>
// element. Timestamps are buttons that seek the audio — the transcript and
// the replay are one instrument, not two sections. All grouping/interleaving
// logic lives in lib/transcript.ts; this component only renders and seeks.

const SPEAKER_LABELS = { interviewer: "Interviewer", candidate: "You" } as const;

function Timestamp({
  atS,
  onSeek,
}: {
  atS: number;
  onSeek: ((atS: number) => void) | null;
}) {
  const label = formatTimestamp(atS);
  if (onSeek === null) {
    return (
      <span className="font-mono text-xs text-neutral-500 tabular-nums">
        {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onSeek(atS)}
      aria-label={`Play the recording from ${label}`}
      className="cursor-pointer font-mono text-xs text-neutral-500 tabular-nums underline decoration-neutral-300 underline-offset-2 hover:text-neutral-900 dark:decoration-neutral-700 dark:hover:text-neutral-100"
    >
      {label}
    </button>
  );
}

export default function TranscriptView({
  segments,
  observations,
  audioUrl,
  audioCaption,
  unavailableNote = "Transcript unavailable for this session.",
}: {
  /** Null = no transcript is stored (sessions scored before transcripts were
   * persisted, or the fetch failed — the page words the note accordingly). */
  segments: TranscriptSegment[] | null;
  observations: TimestampedObservation[];
  /** Signed download URL for the session recording, minted server-side. */
  audioUrl: string | null;
  audioCaption: string;
  unavailableNote?: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);

  const seek =
    audioUrl === null
      ? null
      : (atS: number) => {
          const audio = audioRef.current;
          if (!audio) {
            return;
          }
          audio.currentTime = atS;
          // Autoplay can be blocked; the user still lands at the right spot.
          void audio.play().catch(() => {});
        };

  const timeline =
    segments === null ? [] : transcriptTimeline(segments, observations);

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">Transcript</h2>
      {segments === null ? (
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {unavailableNote}
        </p>
      ) : timeline.length === 0 ? (
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          This session&rsquo;s transcript is empty.
        </p>
      ) : (
        <ol className="flex flex-col gap-4">
          {timeline.map((entry, i) =>
            entry.kind === "turn" ? (
              <li key={i} className="flex flex-col gap-1">
                <div className="flex items-baseline gap-2.5">
                  <Timestamp atS={entry.turn.start_s} onSeek={seek} />
                  <span
                    className={`text-xs font-semibold uppercase tracking-wide ${
                      entry.turn.speaker === "candidate"
                        ? "text-neutral-900 dark:text-neutral-100"
                        : "text-neutral-500"
                    }`}
                  >
                    {SPEAKER_LABELS[entry.turn.speaker]}
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
                  {entry.turn.text}
                </p>
              </li>
            ) : (
              <li
                key={i}
                className="flex items-baseline gap-2.5 rounded-md border-l-2 border-amber-300 bg-amber-50/60 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
              >
                <Timestamp atS={entry.observation.at_s} onSeek={seek} />
                <span>
                  {entry.observation.note}
                  {entry.observation.conflicts_with_dsp ? (
                    <DspConflictBadge />
                  ) : null}
                </span>
              </li>
            ),
          )}
        </ol>
      )}

      {audioUrl !== null ? (
        <div className="sticky bottom-0 mt-2 border-t border-neutral-200 bg-white/95 py-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95">
          {/* preload="none": the signed URL is fetched when the user presses
              play, not on page load — recordings run to tens of MB. */}
          <audio
            ref={audioRef}
            controls
            preload="none"
            src={audioUrl}
            className="w-full"
          />
          <p className="mt-1.5 text-xs text-neutral-500">{audioCaption}</p>
        </div>
      ) : null}
    </section>
  );
}
