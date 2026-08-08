import Link from "next/link";
import { expressionPair, sessionHeading } from "@/components/study-view";
import { formatGeneratedAt } from "@/lib/study";
import type { PackageBookmarks, StudyMaterials } from "@/lib/types";
import { CARD, CHIP, EVIDENCE_QUOTE, FINE_PRINT, PROSE_WIDTH, SECONDARY_BUTTON, SECTION_HEADING, STEP_NUMERAL, SUB_HEADING, SUBTLE } from "@/lib/ui";

export default function StudyGuideView({ packageId, doc, generatedAt, bookmarks, showExports = true }: {
  packageId: string; doc: StudyMaterials; generatedAt: string; bookmarks: PackageBookmarks | null; showExports?: boolean;
}) {
  return <div className="mt-8 space-y-10">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <p className={FINE_PRINT}>Generated {formatGeneratedAt(generatedAt)}</p>
      {showExports ? <div className="flex gap-2">
        <a download className={SECONDARY_BUTTON} href={`/api/study/${packageId}?format=md`}>Markdown</a>
        <a download className={SECONDARY_BUTTON} href={`/api/study/${packageId}?format=pdf`}>PDF</a>
      </div> : null}
    </header>
    <section className="space-y-5"><h2 className={SECTION_HEADING}>Where you stand</h2>
      {doc.summary.core_problems.map((problem) => <article key={problem.title} className="space-y-2"><h3 className={SUB_HEADING}>{problem.title}</h3><p className={`${SUBTLE} ${PROSE_WIDTH}`}>{problem.description}</p><div className="flex flex-wrap gap-1.5">{problem.dimension_keys.map((key) => <span className={CHIP} key={key}>{key}</span>)}</div></article>)}
      <ol className="space-y-3">{doc.summary.improvement_strategy.map((step, index) => <li className="flex gap-3" key={step}><span className={STEP_NUMERAL}>{index + 1}</span><span>{step}</span></li>)}</ol>
      <div className="space-y-2">{doc.summary.priority_expressions.map((item) => <blockquote className={EVIDENCE_QUOTE} key={item}>{item}</blockquote>)}</div>
    </section>
    {bookmarks && bookmarks.sessions.length > 0 ? <section className="space-y-5"><h2 className={SECTION_HEADING}>Saved from your sessions</h2>{bookmarks.sessions.map((session) => <div className="space-y-3" key={session.session_id}><h3 className={SUB_HEADING}><Link href={`/sessions/${session.session_id}?tab=study`}>{sessionHeading(session.session_index)}</Link></h3>{session.items.map((item) => { const pair = expressionPair(item); return <article className={`${CARD} space-y-2 p-4`} key={item.turn_index}><blockquote className={EVIDENCE_QUOTE}>{pair.original}</blockquote><p>{pair.stronger}</p><p className={SUBTLE}>{pair.why}</p></article>; })}</div>)}</section> : null}
    <section className="space-y-4"><h2 className={SECTION_HEADING}>Answers to memorize</h2>{doc.jd_core_answers.map((answer) => <details className={`${CARD} p-4`} key={`${answer.dimension_key}-${answer.question}`}><summary className={`${SUB_HEADING} cursor-pointer`}>{answer.question}</summary><div className="mt-4 space-y-3"><p className={PROSE_WIDTH}>{answer.model_answer}</p><p className={FINE_PRINT}>Generated from your session material.</p>{answer.based_on_quotes.map((quote) => <blockquote className={EVIDENCE_QUOTE} key={quote}>{quote}</blockquote>)}</div></details>)}</section>
  </div>;
}
