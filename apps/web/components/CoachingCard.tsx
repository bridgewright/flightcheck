"use client";

import { useState } from "react";
import { BookmarkSimpleIcon, FlagIcon } from "@phosphor-icons/react";

import { nextMarkForBookmark, nextMarkForFlag, sourceQuoteIfVerbatim } from "@/lib/paraphrase";
import type { TranscriptTurn } from "@/lib/transcript";
import type { ParaphraseFlagReason, ParaphraseItem, ParaphraseMark } from "@/lib/types";
import { DIVIDER, EVIDENCE_QUOTE, FINE_PRINT, LABEL, PROSE_WIDTH, SUBTLE } from "@/lib/ui";

const REASONS: { value: ParaphraseFlagReason; label: string; short: string }[] = [
  { value: "misheard", label: "Misheard what I said", short: "Misheard" },
  { value: "inappropriate", label: "Inappropriate content", short: "Inappropriate" },
  { value: "inaccurate", label: "Inaccurate paraphrase", short: "Inaccurate" },
  { value: "missing", label: "Missing explanation", short: "Missing explanation" },
  { value: "other", label: "Something else", short: "Something else" },
];

export function MarkActions({ mark, onMarkChange }: { mark: ParaphraseMark; onMarkChange: (mark: ParaphraseMark) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState<ParaphraseFlagReason>(mark.flag?.reason ?? "misheard");
  const [note, setNote] = useState(mark.flag?.note ?? "");
  const selected = REASONS.find((option) => option.value === mark.flag?.reason);

  function openFlag(): void {
    setReason(mark.flag?.reason ?? "misheard");
    setNote(mark.flag?.note ?? "");
    setEditing(true);
  }

  return <>
    <div className="flex flex-wrap gap-2">
      <button type="button" aria-label="Bookmark" aria-pressed={mark.bookmarked} className={mark.bookmarked ? "flex items-center gap-1 rounded-control bg-paper-sunk px-2 py-1 text-ink" : "p-1 text-ink-faint"} onClick={() => void onMarkChange(nextMarkForBookmark(mark))}>
        <BookmarkSimpleIcon className="size-5" weight={mark.bookmarked ? "fill" : "regular"} />{mark.bookmarked ? <span>Saved</span> : null}
      </button>
      <button type="button" aria-label="Report an issue" aria-pressed={mark.flag !== null} className={mark.flag ? "flex items-center gap-1 rounded-control bg-alarm-wash px-2 py-1 text-alarm" : "flex items-center gap-1 p-1 text-ink-faint"} onClick={openFlag}>
        <FlagIcon className="size-5" weight={mark.flag ? "fill" : "regular"} /><span>{selected?.short ?? "Report an issue"}</span>
      </button>
    </div>
    {editing ? <form className="flex flex-col gap-3 rounded-surface border border-hairline bg-paper-sunk p-3" onSubmit={(event) => {
      event.preventDefault();
      if (reason === "other" && !note.trim()) return;
      void onMarkChange(nextMarkForFlag(mark, { reason, note })).then(() => setEditing(false));
    }}>
      <fieldset className="flex flex-col gap-2"><legend className={LABEL}>What went wrong?</legend>
        {REASONS.map((option) => <label key={option.value} className="flex items-center gap-2"><input type="radio" name="flag-reason" value={option.value} checked={reason === option.value} onChange={() => setReason(option.value)} />{option.label}</label>)}
      </fieldset>
      <label className="flex flex-col gap-1"><span className={SUBTLE}>Note {reason === "other" ? "(required)" : "(optional)"}</span><textarea value={note} maxLength={500} required={reason === "other"} onChange={(event) => setNote(event.target.value)} className="rounded-control border border-hairline bg-surface p-2 text-ink" /></label>
      <div className="flex flex-wrap gap-2"><button type="submit" className="rounded-control bg-ink px-3 py-1 text-paper">Submit</button><button type="button" className="rounded-control border border-hairline px-3 py-1 text-ink" onClick={() => setEditing(false)}>Cancel</button>
        {mark.flag ? <button type="button" className="text-alarm" onClick={() => void onMarkChange(nextMarkForFlag(mark, null)).then(() => setEditing(false))}>Remove report</button> : null}
      </div>
    </form> : null}
  </>;
}

export default function CoachingCard({ item, turn, mark, onMarkChange }: { item: ParaphraseItem; turn: TranscriptTurn; mark: ParaphraseMark; onMarkChange: (mark: ParaphraseMark) => Promise<void> }) {
  const quote = sourceQuoteIfVerbatim(turn, item.source_quote);
  return <div className={`flex w-full flex-col gap-3 rounded-surface border border-hairline bg-surface p-5 shadow-float ${PROSE_WIDTH}`}>
    <div><p className={LABEL}>{item.verdict === "good" ? "Well said" : "Try it like this"}</p>{item.verdict === "good" ? <p className={SUBTLE}>Another way to say it</p> : null}</div>
    <p className={`text-ink ${PROSE_WIDTH}`}>{item.suggestion}</p><div className={`border-t ${DIVIDER}`} /><p className={SUBTLE}>{item.why}</p>
    {quote ? <div><p className={LABEL}>What you said</p><blockquote className={EVIDENCE_QUOTE}>{quote}</blockquote></div> : null}
    <p className={FINE_PRINT}>A suggested rewrite; your transcript is unchanged.</p><MarkActions mark={mark} onMarkChange={onMarkChange} />
  </div>;
}
