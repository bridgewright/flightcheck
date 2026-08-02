import { Fragment } from "react";

import type { JourneyLeg } from "@/lib/home";

// Start ---o---o---o---•---·---·--- Ready
// The whole package in one line: what you have flown, where you are now, and
// how much runway the package still owes you.
const LEG_STYLES: Record<JourneyLeg, string> = {
  done: "bg-amber shadow-[0_0_8px] shadow-amber/55",
  next: "bg-coral shadow-[0_0_10px] shadow-coral/60",
  todo: "bg-line",
};

const LEG_LABELS: Record<JourneyLeg, string> = {
  done: "done",
  next: "up next",
  todo: "not started",
};

export default function JourneyStrip({ legs }: { legs: JourneyLeg[] }) {
  const done = legs.filter((leg) => leg === "done").length;
  return (
    // One accessible object: the dots are a picture of progress, and reading
    // them out one by one would tell a screen-reader user nothing.
    <div
      role="img"
      aria-label={`Session progress: ${done} of ${legs.length} done`}
      className="flex items-center justify-center gap-[7px] overflow-x-auto px-0.5 py-1 font-data text-xs text-muted"
    >
      <span className="shrink-0 font-semibold tracking-[.06em] text-ink">Start</span>
      {legs.map((leg, i) => (
        <Fragment key={i}>
          <span className="h-px w-5 shrink-0 bg-faint opacity-50" />
          <span
            title={`Session ${i + 1} · ${LEG_LABELS[leg]}`}
            className={`size-[9px] shrink-0 rounded-full ${LEG_STYLES[leg]}`}
          />
        </Fragment>
      ))}
      <span className="h-px w-5 shrink-0 bg-faint opacity-50" />
      <span className="shrink-0 font-semibold tracking-[.06em] text-ink">Ready</span>
    </div>
  );
}
