import Link from "next/link";

import { bookmarkedItems } from "@/lib/paraphrase";
import type { SessionCoaching } from "@/lib/types";
import { CARD, EVIDENCE_QUOTE, FINE_PRINT, LABEL, MUTED, PANEL, PROSE_WIDTH, SECTION_HEADING, SUB_HEADING, SUBTLE } from "@/lib/ui";

export default function SessionStudyTab({ sessionId, coaching }: { sessionId: string; coaching: SessionCoaching | null }) {
  const saved = bookmarkedItems(coaching?.paraphrases, coaching?.marks);
  const insights = coaching?.insights;
  return <div className="flex flex-col gap-10">
    <section className="flex flex-col gap-4">
      <h2 className={SECTION_HEADING}>Saved</h2>
      {saved.length === 0 ? <p className={SUBTLE}>Bookmark a suggestion in the <Link className="underline" href={`/sessions/${sessionId}?tab=transcript`}>Transcript tab</Link> and it collects here.</p> : saved.map(({ ordinal, item }) =>
        <article key={ordinal} className={`${PANEL} flex flex-col gap-2 p-4`}>
          <p className={LABEL}>{item.verdict === "good" ? "Even stronger" : "Stronger phrasing"}</p>
          <blockquote className={EVIDENCE_QUOTE}>{item.source_quote}</blockquote>
          <p className={`text-ink ${PROSE_WIDTH}`}>{item.suggestion}</p><p className={SUBTLE}>{item.why}</p>
        </article>)}
    </section>
    <section className="flex flex-col gap-5">
      <h2 className={SECTION_HEADING}>Session review</h2>
      {!insights ? <p className={SUBTLE}>This session&rsquo;s review will appear for newly scored sessions.</p> : <>
        <div><h3 className={SUB_HEADING}>What went well</h3><ul className={`${MUTED} mt-2 list-disc pl-5`}>{insights.did_well.map((item) => <li key={item}>{item}</li>)}</ul></div>
        <div><h3 className={SUB_HEADING}>What needs work</h3><ul className={`${MUTED} mt-2 list-disc pl-5`}>{insights.did_poorly.map((item) => <li key={item}>{item}</li>)}</ul></div>
        {insights.must_keep.map((item, index) => <article key={index} className={`${PANEL} flex flex-col gap-2 p-4`}><p className={LABEL}>Expression worth keeping</p><blockquote className={EVIDENCE_QUOTE}>{item.said_verbatim}</blockquote><p className="text-ink">{item.better}</p><p className={SUBTLE}>{item.why}</p></article>)}
        <div className="flex flex-col gap-3">{insights.must_answer.map((item, index) => <details key={index} className={`${CARD} p-4`}><summary className={`${SUB_HEADING} cursor-pointer`}>{item.question}</summary><div className="mt-3 flex flex-col gap-3"><p className={PROSE_WIDTH}>{item.model_answer}</p><p className={FINE_PRINT}>Model answer &mdash; generated from your own strongest material</p>{item.based_on_quotes.map((quote) => <blockquote key={quote} className={EVIDENCE_QUOTE}>{quote}</blockquote>)}</div></details>)}</div>
      </>}
    </section>
  </div>;
}
