"use client";

import { Star, StarHalf } from "@phosphor-icons/react";
import { useState } from "react";
import { ratingSpoken, ratingValues, starGlyphs } from "@/lib/feedback";
import { LABEL } from "@/lib/ui";

export default function StarRating({ value, onChange }: { value: number | null; onChange: (value: number) => void }) {
  const [preview, setPreview] = useState<number | null>(null);
  const shown = preview ?? value;
  const glyphs = starGlyphs(shown);
  return (
    <fieldset onPointerLeave={() => setPreview(null)}>
      <legend className={LABEL}>Rating</legend>
      <div className="mt-2 flex w-fit text-ink" aria-hidden="true">
        {glyphs.map((glyph, index) => {
          const Icon = glyph === "half" ? StarHalf : Star;
          return <Icon key={index} size={32} weight={glyph === "empty" ? "regular" : "fill"} className={glyph === "empty" ? "text-ink-faint" : "text-ink"} />;
        })}
      </div>
      <div className="flex w-fit -translate-y-8">
        {ratingValues().map((rating) => (
          <label key={rating} className="h-8 w-4 cursor-pointer" onPointerEnter={() => setPreview(rating)}>
            <span className="sr-only">{ratingSpoken(rating)}</span>
            <input className="sr-only" type="radio" name="rating" value={rating} required checked={value === rating} onChange={() => onChange(rating)} aria-label={ratingSpoken(rating)} />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
