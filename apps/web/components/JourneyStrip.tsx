import { Fragment } from "react";

import Reveal from "@/components/motion/Reveal";
import type { JourneyLeg } from "@/lib/home";

// Start ---o---o---o---•---·---·--- Ready
// The whole package in one row: how many sessions are behind you, which one is
// up next, and how many the package still owes you. Solid / outlined / faint
// carry those three states without relying on colour.
const LEG_STYLES: Record<JourneyLeg, string> = {
  done: "bg-ink",
  next: "border-2 border-ink",
  todo: "bg-hairline",
};

const LEG_LABELS: Record<JourneyLeg, string> = {
  done: "done",
  next: "up next",
  todo: "not started",
};

export default function JourneyStrip({ legs }: { legs: JourneyLeg[] }) {
  const done = legs.filter((leg) => leg === "done").length;
  return (
    // One entry for one object (F-58): the strip is a single picture of
    // progress, so it rises once as a whole, in the landing's vocabulary.
    // Sequencing its dots would argue with the thing the strip is, and the
    // Reveal sits outside the scroll container so the rise is never clipped.
    <Reveal>
      {/* One accessible object: the dots are a picture of progress, and
          reading them out one by one would tell a screen-reader user
          nothing. */}
      <div
        role="img"
        aria-label={`Session progress: ${done} of ${legs.length} done`}
        className="flex items-center justify-center gap-[7px] overflow-x-auto px-0.5 py-1 text-fine text-ink-muted"
      >
        <span className="shrink-0">Start</span>
        {legs.map((leg, i) => (
          <Fragment key={i}>
            <span className="h-px w-5 shrink-0 bg-hairline" />
            <span
              title={`Session ${i + 1} · ${LEG_LABELS[leg]}`}
              className={`size-[9px] shrink-0 rounded-full ${LEG_STYLES[leg]}`}
            />
          </Fragment>
        ))}
        <span className="h-px w-5 shrink-0 bg-hairline" />
        <span className="shrink-0">Ready</span>
      </div>
    </Reveal>
  );
}
