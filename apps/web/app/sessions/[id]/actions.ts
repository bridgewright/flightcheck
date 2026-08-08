"use server";

import type { ParaphraseMark } from "@/lib/types";
import { getViewer } from "@/lib/viewer";
import { authorizeViewerSession, setParaphraseMark } from "@/lib/worker";

export async function setParaphraseMarkAction(sessionId: string, ordinal: number, mark: ParaphraseMark) {
  const viewer = await getViewer();
  if (!viewer) throw new Error("Unauthorized");
  const access = await authorizeViewerSession(viewer, sessionId);
  if (!access.ok) throw new Error("Unauthorized");
  if (!Number.isInteger(ordinal) || ordinal < 0) throw new Error("Invalid turn ordinal");
  if ((mark.reaction !== null && mark.reaction !== "up" && mark.reaction !== "down") || typeof mark.bookmarked !== "boolean") throw new Error("Invalid mark");
  return setParaphraseMark(sessionId, ordinal, mark);
}
