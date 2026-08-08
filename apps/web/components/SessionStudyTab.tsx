import Link from "next/link";

import { qaSets } from "@/lib/session-study";
import type { SessionCoaching, TranscriptSegment } from "@/lib/types";
import { CARD, EVIDENCE_QUOTE, FINE_PRINT, LABEL, LINK, MUTED, PANEL, PROSE_WIDTH, SECONDARY_BUTTON, SECTION_HEADING, SUB_HEADING, SUBTLE } from "@/lib/ui";

export default function SessionStudyTab({ sessionId, coaching, segments }: {
  sessionId: string;
  coaching: SessionCoaching | null;
  segments: TranscriptSegment[];
}) {
  const sets = qaSets(segments, coaching);
  const insights = coaching?.insights ?? null;
  const exportable = sets.length > 0 || insights !== null;
  return <div className="flex flex-col gap-10">
    {exportable ? <div className="flex flex-wrap gap-3">
      <a href={`/api/session-study/${encodeURIComponent(sessionId)}?format=md`} download className={SECONDARY_BUTTON}>MD</a>
      <a href={`/api/session-study/${encodeURIComponent(sessionId)}?format=pdf`} download className={SECONDARY_BUTTON}>PDF</a>
    </div> : null}

    <section className="flex flex-col gap-4">
      <h2 className={SECTION_HEADING}>Saved questions &amp; answers</h2>
      {sets.length === 0 ? <p className={SUBTLE}>Bookmark a suggestion in the <Link className={LINK} href={`/sessions/${sessionId}?tab=transcript`}>Transcript tab</Link> and it collects here.</p> : sets.map((set) =>
        <article key={set.ordinal} className={`${PANEL} flex flex-col gap-3 p-4`}>
          <div><p className={LABEL}>Question</p><p className={PROSE_WIDTH}>{set.question ?? "Question not captured"}</p></div>
          <div><p className={LABEL}>Better answer</p><p className={`text-ink ${PROSE_WIDTH}`}>{set.better}</p></div>
          <div><p className={LABEL}>What you said</p><p className={PROSE_WIDTH}>{set.your_answer}</p></div>
          <p className={SUBTLE}>{set.why}</p>
        </article>)}
    </section>

    {insights && insights.must_answer.length > 0 ? <section className="flex flex-col gap-4">
      <h2 className={SECTION_HEADING}>Core questions to prepare</h2>
      {insights.must_answer.map((item, index) => <details key={index} className={`${CARD} p-4`}><summary className={`${SUB_HEADING} cursor-pointer`}>{item.question}</summary><div className="mt-3 flex flex-col gap-3"><p className={PROSE_WIDTH}>{item.model_answer}</p><p className={FINE_PRINT}>Model answer; generated from your own strongest material.</p>{item.based_on_quotes.map((quote) => <blockquote key={quote} className={EVIDENCE_QUOTE}>{quote}</blockquote>)}</div></details>)}
    </section> : null}

    {insights && insights.must_keep.length > 0 ? <section className="flex flex-col gap-4">
      <h2 className={SECTION_HEADING}>Expressions worth keeping</h2>
      {insights.must_keep.map((item, index) => <article key={index} className={`${PANEL} flex flex-col gap-2 p-4`}><blockquote className={EVIDENCE_QUOTE}>{item.said_verbatim}</blockquote><p className="text-ink">{item.better}</p><p className={SUBTLE}>{item.why}</p><p className={FINE_PRINT}>A suggested rewrite; the quote above is your own wording.</p></article>)}
    </section> : null}

    <section className="flex flex-col gap-5">
      <h2 className={SECTION_HEADING}>Session review</h2>
      {!insights ? <p className={SUBTLE}>This session&rsquo;s review will appear for newly scored sessions.</p> : <>
        <div><h3 className={SUB_HEADING}>What went well</h3><ul className={`${MUTED} mt-2 list-disc pl-5`}>{insights.did_well.map((item) => <li key={item}>{item}</li>)}</ul></div>
        <div><h3 className={SUB_HEADING}>What needs work</h3><ul className={`${MUTED} mt-2 list-disc pl-5`}>{insights.did_poorly.map((item) => <li key={item}>{item}</li>)}</ul></div>
      </>}
    </section>
  </div>;
}
