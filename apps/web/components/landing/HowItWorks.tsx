import { LABEL, MUTED } from "@/lib/ui";

import { HOW_IT_WORKS } from "./copy";

// The loop, in four steps: paste the JD, talk, read the report, go again.
//
// It is a loop rather than a funnel on purpose — the product's promise is
// "repeat until you would pass", so the last step points back at the first
// instead of ending. Numbered because the order is the mechanic.

export default function HowItWorks() {
  return (
    <ol className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
      {HOW_IT_WORKS.map((step, index) => (
        <li key={step.title} className="flex flex-col gap-2">
          <span className={LABEL}>Step {index + 1}</span>
          <h3 className="font-semibold text-balance">{step.title}</h3>
          <p className={`${MUTED} text-sm leading-relaxed`}>{step.detail}</p>
        </li>
      ))}
    </ol>
  );
}
