"use client";

import { FormEvent, useRef, useState } from "react";
import Link from "next/link";

import {
  PREVIEW_JD_MAX_CHARS,
  PREVIEW_JD_MIN_CHARS,
} from "@/app/api/preview/guard";
import {
  CARD,
  CTA_BUTTON,
  FIELD,
  FINE_PRINT,
  LABEL,
  METER_FILL,
  METER_TRACK,
  MUTED,
  NOTICE,
  PRIMARY_BUTTON,
  SUBTLE,
} from "@/lib/ui";

import { PREVIEW_WIDGET, TRIAL_MICROCOPY, tooShortHint } from "./copy";
import type { PreviewState } from "./preview-state";
import {
  asPreview,
  channelLabel,
  orderedDimensions,
  readRefusal,
  weightPercent,
} from "./preview-state";

// F-45. The hero's right pane: paste the job description you are facing, see
// the bar it compiles to, before signing up for anything.
//
// This is the whole argument for the product made in fifteen seconds, and it
// is competitive white space — no candidate-side product shows the rubric
// before signup. It is deliberately partial: dimensions and weights, no
// question bank, no anchors, no session, nothing stored. The footnote says so
// plainly rather than implying the visitor has seen it all.
//
// Every failure state is written as carefully as the success one, because a
// stranger who pasted a JD and got a blank panel is gone. The sentence comes
// from the server (one voice) and the affordance comes from the action the
// refusal calls for: edit the paste, try again, or take the paid path, which
// has no ceiling and no preview-sized length cap.
//
// All prose is in ./copy.ts, where tests/landing-copy-register.test.ts can
// hold it to the same register as the rest of the page.

const SIGN_IN_HREF = "/login?next=/new";

function DimensionRow({
  name,
  weight,
  channel,
}: {
  name: string;
  weight: number;
  channel: "content" | "delivery";
}) {
  const percent = weightPercent(weight);
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-medium">{name}</span>
        <span className={`${SUBTLE} tabular-nums`}>{percent}%</span>
      </div>
      <div className={METER_TRACK}>
        <div className={METER_FILL} style={{ width: `${percent}%` }} />
      </div>
      <span className={FINE_PRINT}>{channelLabel(channel)}</span>
    </li>
  );
}

export default function RubricPreviewWidget() {
  const [jdText, setJdText] = useState("");
  const [state, setState] = useState<PreviewState>({ kind: "idle" });
  // One preview at a time: a second submit abandons the first rather than
  // racing it, so a slow reply can never overwrite a newer one.
  const inFlight = useRef<AbortController | null>(null);

  async function compile(text: string) {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setState({ kind: "compiling" });
    try {
      const response = await fetch("/api/preview/rubric", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jd_text: text }),
        signal: controller.signal,
      });
      const body: unknown = await response.json().catch(() => null);
      if (controller.signal.aborted) {
        return;
      }
      if (!response.ok) {
        setState({ kind: "refused", refusal: readRefusal(body) });
        return;
      }
      const preview = asPreview(body);
      if (preview === null) {
        setState({ kind: "refused", refusal: readRefusal(null) });
        return;
      }
      setState({ kind: "ready", preview });
    } catch {
      if (controller.signal.aborted) {
        return;
      }
      // The network, not the product. Same honest shape as every other
      // refusal, and retrying is a real option here.
      setState({ kind: "refused", refusal: readRefusal(null) });
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void compile(jdText.trim());
  }

  const trimmed = jdText.trim();
  const missing = PREVIEW_JD_MIN_CHARS - trimmed.length;
  const tooLong = trimmed.length > PREVIEW_JD_MAX_CHARS;
  const compiling = state.kind === "compiling";

  return (
    <section
      className={`${CARD} flex w-full flex-col gap-4 p-5`}
      aria-labelledby="preview-heading"
    >
      <div>
        <div className={LABEL}>{PREVIEW_WIDGET.eyebrow}</div>
        <h2 id="preview-heading" className="mt-1 font-semibold">
          {PREVIEW_WIDGET.heading}
        </h2>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-2.5">
        <label htmlFor="jd-preview" className="sr-only">
          Job description
        </label>
        <textarea
          id="jd-preview"
          className={`${FIELD} h-40 resize-y font-mono text-xs leading-relaxed`}
          placeholder={PREVIEW_WIDGET.placeholder}
          value={jdText}
          onChange={(event) => setJdText(event.target.value)}
          disabled={compiling}
        />
        <button
          type="submit"
          className={`${PRIMARY_BUTTON} w-full`}
          disabled={compiling || missing > 0 || tooLong}
        >
          {compiling ? `${PREVIEW_WIDGET.submitting}…` : PREVIEW_WIDGET.submit}
        </button>
        <p className={FINE_PRINT} aria-live="polite">
          {trimmed.length > 0 && missing > 0
            ? tooShortHint(missing)
            : tooLong
              ? PREVIEW_WIDGET.tooLong
              : PREVIEW_WIDGET.hint}
        </p>
      </form>

      <div aria-live="polite">
        {compiling ? <p className={`${MUTED} text-sm`}>{PREVIEW_WIDGET.compiling}</p> : null}

        {state.kind === "refused" ? (
          <div className={`${NOTICE} flex flex-col items-start gap-3`}>
            <p>{state.refusal.message}</p>
            {state.refusal.action === "retry" ? (
              <button
                type="button"
                className={PRIMARY_BUTTON}
                onClick={() => void compile(trimmed)}
              >
                {PREVIEW_WIDGET.retry}
              </button>
            ) : null}
            {state.refusal.action === "sign-in" ? (
              <Link href={SIGN_IN_HREF} className={PRIMARY_BUTTON}>
                {PREVIEW_WIDGET.signIn}
              </Link>
            ) : null}
          </div>
        ) : null}

        {state.kind === "ready" ? (
          <div className="flex flex-col gap-4">
            <div>
              <div className={LABEL}>{PREVIEW_WIDGET.resultLabel}</div>
              <p className="mt-1 font-semibold text-balance">
                {state.preview.role_title}
                {state.preview.company ? (
                  <span className={MUTED}> · {state.preview.company}</span>
                ) : null}
              </p>
            </div>
            <ul className="flex flex-col gap-3.5">
              {orderedDimensions(state.preview.dimensions).map((dimension) => (
                <DimensionRow
                  key={dimension.key}
                  name={dimension.name}
                  weight={dimension.weight}
                  channel={dimension.channel}
                />
              ))}
            </ul>
            <p className={`${MUTED} text-sm`}>{PREVIEW_WIDGET.verdictLine}</p>
            <Link href={SIGN_IN_HREF} className={`${CTA_BUTTON} w-full`}>
              {PREVIEW_WIDGET.cta}
            </Link>
            <p className={FINE_PRINT}>
              {TRIAL_MICROCOPY} {PREVIEW_WIDGET.footnote}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
