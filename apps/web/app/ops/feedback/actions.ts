"use server";

import { revalidatePath } from "next/cache";
import { isOperator } from "@/lib/operator";
import { getViewer } from "@/lib/viewer";
import { setFeedbackStatus } from "@/lib/worker";
import type { FeedbackStatus } from "@/lib/types";

export interface UpdateFeedbackResult { ok: boolean; error?: string }
const STATUSES: FeedbackStatus[] = ["new", "seen", "archived"];

export async function updateFeedbackStatusAction(
  feedbackId: string,
  status: string,
): Promise<UpdateFeedbackResult> {
  const viewer = await getViewer();
  if (!isOperator(viewer?.id, process.env.OPERATOR_USER_ID)) return { ok: false, error: "not-found" };
  if (!STATUSES.includes(status as FeedbackStatus)) return { ok: false, error: "invalid-status" };
  try {
    await setFeedbackStatus(feedbackId, status as FeedbackStatus);
    revalidatePath("/ops/feedback");
    return { ok: true };
  } catch {
    return { ok: false, error: "update-failed" };
  }
}
