"use client";

import { useActionState, useState } from "react";
import { submitFeedbackAction } from "@/app/feedback/actions";
import { FEEDBACK_TEXT_MAX } from "@/lib/feedback";
import { ERROR_TEXT, FIELD, LABEL, NOTICE, PRIMARY_BUTTON, SUBTLE } from "@/lib/ui";
import StarRating from "./StarRating";

export default function FeedbackForm({ packageId }: { packageId?: string }) {
  const [rating, setRating] = useState<number | null>(null);
  const [count, setCount] = useState(0);
  const [state, action, pending] = useActionState(submitFeedbackAction, { ok: false });
  if (state.ok) return <p className={NOTICE}>Thank you {String.fromCharCode(8212)} received.</p>;
  return (
    <form action={action} className="mt-8 flex flex-col gap-4">
      {packageId && <input type="hidden" name="package_id" value={packageId} />}
      <StarRating value={rating} onChange={setRating} />
      <label className={LABEL} htmlFor="feedback-body">Anything else? (optional)</label>
      <textarea id="feedback-body" name="body" rows={7} maxLength={FEEDBACK_TEXT_MAX} className={FIELD} onChange={(event) => setCount(event.target.value.length)} />
      <p className={SUBTLE}>{count} / {FEEDBACK_TEXT_MAX}</p>
      {state.error && <p className={ERROR_TEXT}>{state.error}</p>}
      <button className={PRIMARY_BUTTON} type="submit" disabled={pending || rating === null}>{pending ? "Sending…" : "Send feedback"}</button>
    </form>
  );
}
