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
  if (mark.flag !== null) {
    const reasons = ["misheard", "inappropriate", "inaccurate", "missing", "other"];
    if (!mark.flag || typeof mark.flag !== "object" || Array.isArray(mark.flag)) throw new Error("Invalid flag");
    const keys = Object.keys(mark.flag);
    if (keys.length !== 2 || !keys.includes("reason") || !keys.includes("note") || !reasons.includes(mark.flag.reason) || typeof mark.flag.note !== "string" || mark.flag.note.length > 500 || (mark.flag.reason === "other" && !mark.flag.note.trim())) throw new Error("Invalid flag");
  }
  return setParaphraseMark(sessionId, ordinal, mark);
}
