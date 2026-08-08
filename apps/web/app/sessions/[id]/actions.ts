"use server";

import type { ParaphraseMark } from "@/lib/types";
import { sanitizedFlag } from "@/lib/paraphrase";
import { getViewer } from "@/lib/viewer";
import { authorizeViewerSession, setParaphraseMark } from "@/lib/worker";

export async function setParaphraseMarkAction(sessionId: string, ordinal: number, mark: ParaphraseMark) {
  const viewer = await getViewer();
  if (!viewer) throw new Error("Unauthorized");
  const access = await authorizeViewerSession(viewer, sessionId);
  if (!access.ok) throw new Error("Unauthorized");
  if (!Number.isInteger(ordinal) || ordinal < 0) throw new Error("Invalid turn ordinal");
  if ((mark.reaction !== null && mark.reaction !== "up" && mark.reaction !== "down") || typeof mark.bookmarked !== "boolean") throw new Error("Invalid mark");
  const flag = sanitizedFlag(mark.flag);
  if (flag === "invalid") throw new Error("Invalid flag");
  // The mark is rebuilt from the validated fields: extra keys from the
  // client never reach the worker, whose schema forbids them.
  return setParaphraseMark(sessionId, ordinal, {
    reaction: mark.reaction,
    bookmarked: mark.bookmarked,
    flag,
  });
}
