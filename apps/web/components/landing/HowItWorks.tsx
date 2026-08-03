import Reveal from "@/components/motion/Reveal";
import { ENTRY_STAGGER_SECONDS } from "@/components/motion/entry";
import { MUTED, STEP_NUMERAL, SUB_HEADING } from "@/lib/ui";

import { HOW_IT_WORKS } from "./copy";

// The loop, in four steps: paste the JD, talk, read the report, go again.
//
// It is a loop rather than a funnel on purpose. The product's promise is
// "repeat until you would pass", so the last step points back at the first
// instead of ending, and the order is the mechanic.
//
// What carries that order is a large serif numeral, not an eyebrow. The block
// used to print "STEP 1" through "STEP 4" above four identical cells, which is
// two named bans at once: generic step labels (taste-skill 9.F) and a row of
// equal feature cards (9.C). The numerals are aria-hidden because the ol
// already tells a screen reader the order, and saying it twice is noise.
//
// The composition, stated rather than left to Tailwind. From md up the four
// steps sit as two unequal pairs, 7/5 then 5/7, and the second of each pair
// drops by a half step, so the block reads as a sequence with rhythm instead of
// a grid. Below md every step is one full-width row in source order.
const SPANS = [
  "md:col-span-7",
  "md:col-span-5 md:mt-12",
  "md:col-span-5",
  "md:col-span-7 md:mt-12",
];

export default function HowItWorks() {
  return (
    <ol className="grid grid-cols-1 gap-10 md:grid-cols-12 md:gap-x-10 md:gap-y-14">
      {HOW_IT_WORKS.map((step, index) => (
        <li key={step.title} className={SPANS[index]}>
          <Reveal
            className="flex flex-col gap-2"
            delay={index * ENTRY_STAGGER_SECONDS}
          >
            <span aria-hidden="true" className={STEP_NUMERAL}>
              {index + 1}
            </span>
            <h3 className={SUB_HEADING}>{step.title}</h3>
            <p className={`${MUTED} text-sm leading-relaxed`}>{step.detail}</p>
          </Reveal>
        </li>
      ))}
    </ol>
  );
}
