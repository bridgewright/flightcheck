import RevealGroup from "@/components/motion/RevealGroup";

import ScreenFrame from "./ScreenFrame";
import { SCREENSHOTS } from "./copy";

// The four screens a buyer wants to see before paying: the compiled bar, the
// room they will sit in, the report they will get, and what progress across a
// whole package looks like. Framed, because framed screens read as a product
// and raw crops read as decoration.
//
// The frames arrive in order rather than together, which is the same argument
// the numerals make in HowItWorks: this is a sequence, and four things landing
// at once would flatten it. Its parent Section leaves the body alone
// (revealBody={false}) so the entry happens once, here, per cell.
//
// Mobile: one frame per row below sm, two from sm up.

export default function Showcase() {
  return (
    <RevealGroup className="grid grid-cols-1 gap-8 sm:grid-cols-2">
      {SCREENSHOTS.map((shot) => (
        <ScreenFrame
          key={shot.key}
          title={shot.title}
          caption={shot.caption}
          src={shot.src}
        />
      ))}
    </RevealGroup>
  );
}
