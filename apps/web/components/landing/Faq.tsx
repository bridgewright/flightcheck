import { MinusIcon, PlusIcon } from "@phosphor-icons/react/ssr";

import { CARD, DIVIDE_Y, MUTED, SUB_HEADING } from "@/lib/ui";

import { FAQ } from "./copy";

// The six questions people actually ask before paying, answered on the page
// rather than behind a docs link. Native details/summary: it is keyboard
// accessible, it works before hydration, and it is findable by the browser's
// own in-page search. Those are three things a JavaScript accordion gives up.
//
// The toggle glyphs used to be a "+" character and a Unicode minus sign typed
// into the markup. Text glyphs render differently per platform and per font, so
// they are now Phosphor icons at the family's default `regular` weight, imported
// from the package's ssr entry point because this stays a server component.
// currentColor and a 1em box mean the icon inherits the summary's own ink and
// size instead of declaring either.
//
// What is deliberately NOT here is an open transition. The motion budget allows
// one, and it is declined for a reason worth writing down: animating a details
// panel open means animating height, and the same budget permits transform and
// opacity only. The alternative, replacing details with a JavaScript accordion,
// would buy the animation by giving up pre-hydration behaviour and in-page
// search. The panel opens instantly, and that is the better trade.

export default function Faq() {
  return (
    <div className={`${CARD} ${DIVIDE_Y}`}>
      {FAQ.map((entry) => (
        <details key={entry.question} className="group px-5 py-4">
          <summary className={`flex cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden ${SUB_HEADING}`}>
            {entry.question}
            <PlusIcon aria-hidden="true" className="shrink-0 group-open:hidden" />
            <MinusIcon aria-hidden="true" className="hidden shrink-0 group-open:block" />
          </summary>
          <p className={`${MUTED} mt-3 text-fine`}>{entry.answer}</p>
        </details>
      ))}
    </div>
  );
}
