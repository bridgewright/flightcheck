"use server";

import { FEEDBACK_TEXT_MAX, isValidRating, toHalfStars } from "@/lib/feedback";
import { getViewer } from "@/lib/viewer";
import { submitFeedback } from "@/lib/worker";

export interface SubmitFeedbackResult { ok: boolean; error?: string }

export async function submitFeedbackAction(
  _previous: SubmitFeedbackResult,
  formData: FormData,
): Promise<SubmitFeedbackResult> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: "sign-in" };
  const rating = Number(formData.get("rating"));
  const body = String(formData.get("body") ?? "");
  if (!isValidRating(rating)) return { ok: false, error: "Choose a rating." };
  if (body.length > FEEDBACK_TEXT_MAX) return { ok: false, error: "Feedback is too long." };
  const packageValue = formData.get("package_id");
  const package_id = typeof packageValue === "string" && packageValue ? packageValue : undefined;
  try {
    await submitFeedback({ user_id: viewer.id, rating_half_stars: toHalfStars(rating), body, package_id });
    return { ok: true };
  } catch {
    return { ok: false, error: "We couldn't send that just now. Try again in a moment." };
  }
}
