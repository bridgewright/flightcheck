"use client";

import { useEffect, useState } from "react";
import { BookmarkSimpleIcon, ThumbsDownIcon, ThumbsUpIcon } from "@phosphor-icons/react";

import { markFor, sourceQuoteIfVerbatim } from "@/lib/paraphrase";
import type { TranscriptTurn } from "@/lib/transcript";
import type { ParaphraseItem, ParaphraseMark, ParaphraseMarks } from "@/lib/types";
import { DIVIDER, EVIDENCE_QUOTE, FINE_PRINT, LABEL, PROSE_WIDTH, SUBTLE } from "@/lib/ui";

export function MarkActions({ ordinal, initial, action }: { ordinal: number; initial: ParaphraseMark; action?: (ordinal: number, mark: ParaphraseMark) => Promise<ParaphraseMarks> }) {
  const [mark, setMark] = useState(initial);
  async function update(next: ParaphraseMark) {
    const previous = mark;
    setMark(next);
    if (!action) return;
    try {
      setMark(markFor(await action(ordinal, next), ordinal));
    } catch {
      setMark(previous);
    }
  }
  const button = (pressed: boolean) => `p-1 ${pressed ? "text-ink" : "text-ink-faint"}`;
  return <div className="flex gap-2">
    <button type="button" aria-label="Helpful" aria-pressed={mark.reaction === "up"} className={button(mark.reaction === "up")} onClick={() => void update({ ...mark, reaction: mark.reaction === "up" ? null : "up" })}><ThumbsUpIcon className="size-5" /></button>
    <button type="button" aria-label="Not helpful" aria-pressed={mark.reaction === "down"} className={button(mark.reaction === "down")} onClick={() => void update({ ...mark, reaction: mark.reaction === "down" ? null : "down" })}><ThumbsDownIcon className="size-5" /></button>
    <button type="button" aria-label="Bookmark" aria-pressed={mark.bookmarked} className={button(mark.bookmarked)} onClick={() => void update({ ...mark, bookmarked: !mark.bookmarked })}><BookmarkSimpleIcon className="size-5" /></button>
  </div>;
}

export default function CoachingDialog({ open, onClose, item, turn, ordinal, initialMark, marksAction }: {
  open: boolean;
  onClose: () => void;
  item: ParaphraseItem;
  turn: TranscriptTurn;
  ordinal: number;
  initialMark: ParaphraseMark;
  marksAction?: (ordinal: number, mark: ParaphraseMark) => Promise<ParaphraseMarks>;
}) {
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  if (!open) return null;
  const quote = sourceQuoteIfVerbatim(turn, item.source_quote);
  return <div className="fixed inset-0 bg-ink/40" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <div role="dialog" aria-modal="true" className="absolute left-1/2 top-1/2 flex w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-surface border border-hairline bg-surface p-5 shadow-float">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute right-3 top-3 text-ink-faint">×</button>
      <div>
        <p className={LABEL}>{item.verdict === "good" ? "Well said" : "Try it like this"}</p>
        {item.verdict === "good" ? <p className={SUBTLE}>Another way to say it</p> : null}
      </div>
      <p className={`text-ink ${PROSE_WIDTH}`}>{item.suggestion}</p>
      <div className={`border-t ${DIVIDER}`} />
      <p className={SUBTLE}>{item.why}</p>
      {quote ? <div><p className={LABEL}>What you said</p><blockquote className={EVIDENCE_QUOTE}>{quote}</blockquote></div> : null}
      <p className={FINE_PRINT}>A suggested rewrite; your transcript is unchanged.</p>
      <MarkActions ordinal={ordinal} initial={initialMark} action={marksAction} />
    </div>
  </div>;
}
