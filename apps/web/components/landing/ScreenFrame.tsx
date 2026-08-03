import {
  FINE_PRINT,
  MUTED,
  PLACEHOLDER_HATCH,
  SCREEN_BODY,
  SCREEN_CHROME,
  SCREEN_DOT,
  SCREEN_FRAME,
} from "@/lib/ui";

import { PLACEHOLDER_LABEL } from "./copy";

// A product screen in browser chrome, or an unmistakable placeholder.
//
// Real captures land after the F-21 design pass restyles the product —
// shipping a screenshot of a UI we are about to replace would show the buyer
// something they will never see. Until then this renders a hatched panel that
// says what it is. The failure mode this guards against is a placeholder that
// looks finished enough to ship by accident, so it is labelled rather than
// merely empty.
//
// Swapping in the real thing: drop the capture at public/screens/<key>.png
// and set `src` in copy.ts. No component changes.

export default function ScreenFrame({
  title,
  caption,
  src,
}: {
  title: string;
  caption: string;
  src: string | null;
}) {
  return (
    <figure className="flex flex-col gap-3">
      <div className={SCREEN_FRAME}>
        <div className={SCREEN_CHROME} aria-hidden="true">
          <span className={SCREEN_DOT} />
          <span className={SCREEN_DOT} />
          <span className={SCREEN_DOT} />
        </div>
        {src ? (
          // A fixed-size static capture in a fixed-size frame: next/image
          // would add a loader round trip and buy nothing here.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={`${title}: ${caption}`} className={SCREEN_BODY} />
        ) : (
          <div
            className={`${SCREEN_BODY} flex items-center justify-center`}
            style={{ backgroundImage: PLACEHOLDER_HATCH }}
          >
            <span className={FINE_PRINT}>{PLACEHOLDER_LABEL}</span>
          </div>
        )}
      </div>
      <figcaption className="flex flex-col gap-1">
        <span className="font-medium">{title}</span>
        <span className={`${MUTED} text-sm`}>{caption}</span>
      </figcaption>
    </figure>
  );
}
