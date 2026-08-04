"use client";

import Image from "next/image";
import { useState } from "react";

// The employer's favicon beside the company name (F-54).
//
// A client component for one reason: `onError`. The mark is decoration, and
// every way it can fail (the domain has no favicon, the fetch timed out, the
// file was not an image) has to end as an absent icon rather than a broken
// one. The server route answers 404 for all of those; this hides the element
// when it does.
//
// `alt=""` and aria-hidden: the company name is right beside it and says the
// same thing. A screen reader announcing "Anthropic logo, Anthropic" is worse
// than silence.
//
// The box reserves its space whether or not the image loads, so a late 404
// does not shift the line under the title.

export default function CompanyMark({ packageId }: { packageId: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <Image
      src={`/api/company-mark/${encodeURIComponent(packageId)}`}
      alt=""
      aria-hidden="true"
      width={14}
      height={14}
      loading="lazy"
      // The bytes are already whatever the employer serves, at icon size. The
      // optimizer would fetch, re-encode and bill for a 14px decoration, and
      // it cannot improve a favicon.
      unoptimized
      className="mt-px size-3.5 shrink-0 rounded-[2px] object-contain"
      onError={() => setFailed(true)}
    />
  );
}
