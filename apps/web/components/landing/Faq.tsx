import { CARD, DIVIDE_Y, MUTED } from "@/lib/ui";

import { FAQ } from "./copy";

// The six questions people actually ask before paying, answered on the page
// rather than behind a docs link. Native details/summary: it is keyboard
// accessible, it works before hydration, and it is findable by the browser's
// own in-page search — three things a JavaScript accordion gives up.

export default function Faq() {
  return (
    <div className={`${CARD} ${DIVIDE_Y}`}>
      {FAQ.map((entry) => (
        <details key={entry.question} className="group px-5 py-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
            {entry.question}
            <span aria-hidden="true" className="text-xs group-open:hidden">
              +
            </span>
            <span aria-hidden="true" className="hidden text-xs group-open:inline">
              −
            </span>
          </summary>
          <p className={`${MUTED} mt-3 text-sm leading-relaxed`}>{entry.answer}</p>
        </details>
      ))}
    </div>
  );
}
