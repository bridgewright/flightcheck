"use client";

import { useRef, useState } from "react";
import CoachingDialog from "@/components/CoachingDialog";
import { DspConflictBadge } from "@/components/ReportView";
import { formatTimestamp } from "@/lib/report-format";
import { candidateTurns, transcriptTimeline } from "@/lib/transcript";
import { attachCoaching, markFor } from "@/lib/paraphrase";
import type { ParaphraseMark, ParaphraseMarks, SessionCoaching, TimestampedObservation, TranscriptSegment } from "@/lib/types";
import {
  FINE_PRINT,
  MUTED,
  PANEL,
  PROSE_WIDTH,
  LINK,
  SECTION_HEADING,
  CHIP_ALARM, CHIP_READY, SUBTLE,
} from "@/lib/ui";

// The session transcript with the judge's delivery observations inlined at
// their timestamps, plus the recording itself in a sticky native <audio>
// element. Timestamps are buttons that seek the audio: the transcript and
// the replay are one instrument, not two sections. All grouping/interleaving
// logic lives in lib/transcript.ts; this component only renders and seeks.

const SPEAKER_LABELS = { interviewer: "Interviewer", candidate: "You" } as const;

// LABEL bakes its own ink in, and this label carries two: the candidate's turns
// are the ones being scored and read at full ink, the interviewer's step back.
// So it composes the same type step from the system rather than overriding a
// token's colour with a second colour utility.
const SPEAKER = "font-mono text-label uppercase";

const TIMESTAMP = "font-mono text-fine tabular-nums text-ink-faint";

function Timestamp({
  atS,
  onSeek,
}: {
  atS: number;
  onSeek: ((atS: number) => void) | null;
}) {
  const label = formatTimestamp(atS);
  if (onSeek === null) {
    return <span className={TIMESTAMP}>{label}</span>;
  }
  return (
    <button
      type="button"
      onClick={() => onSeek(atS)}
      aria-label={`Play the recording from ${label}`}
      className={`${TIMESTAMP} ${LINK} cursor-pointer hover:text-ink`}
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
  coaching = null,
  marksAction,
}: {
  /** Null = no transcript is stored (sessions scored before transcripts were
   * persisted, or the fetch failed, and the page words the note accordingly). */
  segments: TranscriptSegment[] | null;
  observations: TimestampedObservation[];
  /** Signed download URL for the session recording, minted server-side. */
  audioUrl: string | null;
  audioCaption: string;
  unavailableNote?: string;
  coaching?: SessionCoaching | null;
  marksAction?: (ordinal: number, mark: ParaphraseMark) => Promise<ParaphraseMarks>;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [openOrdinal, setOpenOrdinal] = useState<number | null>(null);

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

  const timelineBase =
    segments === null ? [] : transcriptTimeline(segments, observations);
  const timeline = attachCoaching(timelineBase, coaching?.paraphrases, segments === null ? 0 : candidateTurns(segments).length);
  const attachedCount = timeline.filter((entry) => entry.kind === "turn" && entry.item !== null).length;

  return (
    <section className="flex flex-col gap-4">
      <h2 className={SECTION_HEADING}>Transcript</h2>
      {attachedCount > 0 ? <p className={SUBTLE}>Suggested phrasings appear under your answers. The transcript itself is untouched.</p> : null}
      {segments === null ? (
        <p className={MUTED}>{unavailableNote}</p>
      ) : timeline.length === 0 ? (
        <p className={MUTED}>This session&rsquo;s transcript is empty.</p>
      ) : (
        <ol className="flex flex-col gap-4">
          {timeline.map((entry, i) =>
            entry.kind === "turn" ? (
              <li key={i} className={`flex flex-col gap-1 ${entry.turn.speaker === "candidate" ? "items-end" : "items-start"}`}>
                <div className={`${entry.turn.speaker === "candidate" ? "ml-auto bg-paper-sunk" : "border border-hairline bg-surface"} ${PROSE_WIDTH} rounded-surface p-4`}>
                  <div className="flex items-baseline gap-2.5">
                  <Timestamp atS={entry.turn.start_s} onSeek={seek} />
                  <span
                    className={`${SPEAKER} ${
                      entry.turn.speaker === "candidate"
                        ? "text-ink"
                        : "text-ink-faint"
                    }`}
                  >
                    {SPEAKER_LABELS[entry.turn.speaker]}
                  </span>
                  </div>
                  <p className={MUTED}>{entry.turn.text}</p>
                </div>
                {entry.item !== null && entry.candidateOrdinal !== null ? <>
                  <button type="button" onClick={() => setOpenOrdinal(entry.candidateOrdinal)} className={`${entry.item.verdict === "good" ? CHIP_READY : CHIP_ALARM} w-fit`}>
                    {entry.item.verdict === "good" ? "✓ Well said" : "! Needs work"}
                  </button>
                  <CoachingDialog open={openOrdinal === entry.candidateOrdinal} onClose={() => setOpenOrdinal(null)} item={entry.item} turn={entry.turn} ordinal={entry.candidateOrdinal} initialMark={markFor(coaching?.marks, entry.candidateOrdinal)} marksAction={marksAction} />
                </> : null}
              </li>
            ) : (
              // A delivery observation, annotating the turn it sits beside.
              // A sunk ground says "this is a note about the transcript" the
              // way a margin note does; it is not a warning, and this product
              // keeps alarm for destructive actions and real errors.
              <li
                key={i}
                className={`${PANEL} flex items-baseline gap-2.5 px-3 py-2 text-fine`}
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
        <div className="sticky bottom-0 mt-2 border-t border-hairline bg-paper/95 py-3 backdrop-blur">
          {/* preload="none": the signed URL is fetched when the user presses
              play, not on page load, because recordings run to tens of MB. */}
          <audio
            ref={audioRef}
            controls
            preload="none"
            src={audioUrl}
            className="w-full"
          />
          <p className={`${FINE_PRINT} mt-1.5`}>{audioCaption}</p>
        </div>
      ) : null}
    </section>
  );
}
