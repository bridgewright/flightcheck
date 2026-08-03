import { ImageResponse } from "next/og";

import { HERO } from "@/components/landing/copy";

// The card that unfurls when someone pastes a flightcheck link into Slack.
//
// It sits at the app root, so every route under it that does not define its
// own inherits this image — which is what we want: one card, correct
// everywhere, rather than six chances to get one wrong. The private routes
// inherit it too and are kept out of indexes by robots.ts instead.
//
// Generated rather than a static file because the headline should not be able
// to drift from the page's: it comes from components/landing/copy.ts, the
// same string the hero renders, and the same string the copy-register test
// holds to the honest voice.
//
// Constraints of the renderer, learned the hard way: satori supports flexbox
// and a subset of CSS only (no grid), and every element with more than one
// child needs an explicit display. Colours are literals here because Tailwind
// does not run in this context; when F-21 re-points the palette, this file is
// the one screen it has to edit by hand.

export const alt =
  "flightcheck: practice interviews scored against the bar of the job you are applying to";

export const size = { width: 1200, height: 630 };

export const contentType = "image/png";

// Kept in step with app/globals.css by hand, which is what the note above
// promised F-21 would have to do. These four are the only literals in the
// product outside the token file; satori runs before Tailwind exists, so a
// var() here would render as nothing. The Ready word takes the sage that
// marks that one verdict everywhere else.
const INK = "#3c2e2a";
const MUTED_INK = "#6b5f59";
const PAPER = "#fbfbf8";
const RULE = "#e7e4dc";
const READY = "#4a6b4f";

const VERDICTS = ["Not yet ready", "Approaching", "Ready"];

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          padding: 72,
          background: PAPER,
          color: INK,
          fontSize: 32,
        }}
      >
        <div style={{ display: "flex", fontSize: 30, letterSpacing: -0.5 }}>
          <span style={{ fontWeight: 700 }}>flight</span>
          <span>check</span>
        </div>

        <div
          style={{
            display: "flex",
            fontSize: 76,
            fontWeight: 700,
            lineHeight: 1.15,
            letterSpacing: -2,
            maxWidth: 940,
          }}
        >
          {HERO.heading}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", width: "100%", height: 1, background: RULE }} />
          <div style={{ display: "flex", gap: 16, fontSize: 28, color: MUTED_INK }}>
            {VERDICTS.map((verdict, index) => (
              <div key={verdict} style={{ display: "flex", gap: 16 }}>
                {index > 0 ? <span>·</span> : null}
                <span
                  style={{
                    color: index === VERDICTS.length - 1 ? READY : MUTED_INK,
                    fontWeight: index === VERDICTS.length - 1 ? 600 : 400,
                  }}
                >
                  {verdict}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
