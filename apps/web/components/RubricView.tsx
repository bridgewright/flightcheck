import { CaretRightIcon } from "@phosphor-icons/react/ssr";

import type { Rubric } from "@/lib/types";
import {
  channelLabel,
  DELIVERY_RECEIPT,
  formatWeight,
  hasReceipts,
  probingLabel,
  PROFILE_RECEIPT,
  sortedAnchors,
} from "@/lib/rubric-format";
import {
  DIVIDE_Y,
  EVIDENCE_QUOTE,
  FINE_PRINT,
  LABEL,
  MUTED,
  PANEL,
  PROSE_WIDTH,
  LINK,
  SECTION_HEADING,
  SUBTLE,
} from "@/lib/ui";

// The full rubric, promoted from a collapsed footnote on the old package page
// to the substance of /rubric (S5): this screen is where the product shows
// the bar it will hold the candidate to. Server component, presentation only.
//
// Drawn as divided rows rather than as one bordered card per dimension. Six
// identical cards is the same section-layout repetition the report had, and it
// matters more here: this screen and the report are meant to read as the same
// document seen twice, once before the session and once after.
//
// rubric.question_bank is deliberately NOT rendered anywhere: showing the
// questions before the session would let the candidate rehearse them, and a
// rehearsed answer scores as prepared delivery, so the verdict would stop
// meaning "would you pass". The dimensions and anchors are the bar; the
// questions are the probe.
export default function RubricView({ rubric }: { rubric: Rubric }) {
  // F-62: does this rubric carry receipts at all? Decided once for the whole
  // rubric, because the delivery line below must never key on channel alone:
  // a pre-F-62 rubric has no receipt on any dimension and renders exactly as
  // it did before the field existed.
  const receipts = hasReceipts(rubric.dimensions);

  return (
    <div className="flex flex-col gap-6">
      {rubric.research_summary ? (
        <details className={`${PANEL} group px-4 py-3`}>
          <summary
            className={`${MUTED} flex cursor-pointer list-none items-center gap-2 text-fine [&::-webkit-details-marker]:hidden`}
          >
            <CaretRightIcon
              aria-hidden="true"
              className="shrink-0 transition-transform group-open:rotate-90"
            />
            How this role actually interviews: research summary
          </summary>
          <p className={`${MUTED} ${PROSE_WIDTH} mt-3 text-fine whitespace-pre-line`}>
            {rubric.research_summary}
          </p>
        </details>
      ) : null}

      <ol className={DIVIDE_Y}>
        {rubric.dimensions.map((dimension) => {
          // The receipt (F-62): why this dimension exists, in the JD's own
          // words. Rubrics stored before the field existed carry no receipt
          // and must render exactly as today, so absence collapses to "".
          const evidence = dimension.jd_evidence?.trim() ?? "";
          // The probing posture (F-94): an indirect dimension gets no
          // question of its own, and the meta line says so. probingLabel
          // returns null for "direct" AND for absence, so rubrics stored
          // before the field existed keep today's meta line untouched.
          const probing = probingLabel(dimension);
          return (
            <li key={dimension.key} className="flex flex-col gap-3 py-5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className={SECTION_HEADING}>{dimension.name}</h2>
                <span className={SUBTLE}>
                  {formatWeight(dimension.weight)} of your score ·{" "}
                  {channelLabel(dimension.channel)}
                  {probing ? <> · {probing}</> : null}
                </span>
              </div>

              {dimension.signals.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <h3 className={LABEL}>What the interviewer listens for</h3>
                  <ul className={`${MUTED} list-disc pl-5 text-fine`}>
                    {dimension.signals.map((signal) => (
                      <li key={signal}>{signal}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {dimension.anchors.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <h3 className={LABEL}>How answers are scored</h3>
                  <ul className="flex flex-col gap-1 text-fine">
                    {sortedAnchors(dimension.anchors).map((anchor) => (
                      <li key={anchor.score} className="flex gap-3">
                        <span className="w-4 shrink-0 text-right font-medium tabular-nums text-ink">
                          {anchor.score}
                        </span>
                        <span className="text-ink-muted">{anchor.behavior}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {dimension.license === "profile" ? (
                <p className={FINE_PRINT}>{PROFILE_RECEIPT}</p>
              ) : evidence ? (
                <div className="flex flex-col gap-1.5">
                  <h3 className={LABEL}>From your job description</h3>
                  <blockquote className={EVIDENCE_QUOTE}>
                    &ldquo;{evidence}&rdquo;
                  </blockquote>
                </div>
              ) : receipts && dimension.channel === "delivery" ? (
                <p className={FINE_PRINT}>{DELIVERY_RECEIPT}</p>
              ) : null}

              {dimension.citations.length > 0 ? (
                <p className={FINE_PRINT}>
                  Sources:{" "}
                  {dimension.citations.map((citation, i) => (
                    <span key={citation.url}>
                      {i > 0 ? " · " : ""}
                      <a
                        href={citation.url}
                        target="_blank"
                        rel="noreferrer"
                        className={LINK}
                      >
                        {citation.title}
                      </a>
                    </span>
                  ))}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
