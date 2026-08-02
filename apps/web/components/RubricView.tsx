import type { Rubric } from "@/lib/types";
import { channelLabel, formatWeight, sortedAnchors } from "@/lib/rubric-format";
import { LABEL } from "@/lib/ui";

// The full rubric, promoted from a collapsed footnote on the old package page
// to the substance of /rubric (S5): this screen is where the product shows
// the bar it will hold the candidate to. Server component, presentation only.
//
// rubric.question_bank is deliberately NOT rendered anywhere: showing the
// questions before the session would let the candidate rehearse them, and a
// rehearsed answer scores as prepared delivery — the verdict would stop
// meaning "would you pass". The dimensions and anchors are the bar; the
// questions are the probe.
export default function RubricView({ rubric }: { rubric: Rubric }) {
  return (
    <div className="flex flex-col gap-6">
      {rubric.research_summary ? (
        <details className="group rounded-md border border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400 [&::-webkit-details-marker]:hidden">
            <span
              aria-hidden="true"
              className="text-[10px] transition-transform group-open:rotate-90"
            >
              ▶
            </span>
            How this role actually interviews — research summary
          </summary>
          <p className="mt-3 text-sm whitespace-pre-line text-neutral-600 dark:text-neutral-400">
            {rubric.research_summary}
          </p>
        </details>
      ) : null}

      <ol className="flex flex-col gap-4">
        {rubric.dimensions.map((dimension) => (
          <li
            key={dimension.key}
            className="flex flex-col gap-3 rounded-md border border-neutral-200 p-5 dark:border-neutral-800"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="font-semibold">{dimension.name}</h2>
              <span className="text-xs text-neutral-500">
                {formatWeight(dimension.weight)} of your score ·{" "}
                {channelLabel(dimension.channel)}
              </span>
            </div>

            {dimension.signals.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <h3 className={LABEL}>What the interviewer listens for</h3>
                <ul className="list-disc pl-5 text-sm text-neutral-600 dark:text-neutral-400">
                  {dimension.signals.map((signal) => (
                    <li key={signal}>{signal}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {dimension.anchors.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <h3 className={LABEL}>How answers are scored</h3>
                <ul className="flex flex-col gap-1 text-sm">
                  {sortedAnchors(dimension.anchors).map((anchor) => (
                    <li key={anchor.score} className="flex gap-3">
                      <span className="w-4 shrink-0 text-right font-medium tabular-nums">
                        {anchor.score}
                      </span>
                      <span className="text-neutral-600 dark:text-neutral-400">
                        {anchor.behavior}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {dimension.citations.length > 0 ? (
              <p className="text-xs text-neutral-500">
                Sources:{" "}
                {dimension.citations.map((citation, i) => (
                  <span key={citation.url}>
                    {i > 0 ? " · " : ""}
                    <a
                      href={citation.url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2"
                    >
                      {citation.title}
                    </a>
                  </span>
                ))}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
