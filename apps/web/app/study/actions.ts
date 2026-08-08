"use server";

import { getViewer } from "@/lib/viewer";
import { generatePackageStudy, listPackagesForUser, WorkerError } from "@/lib/worker";

export interface GenerateStudyResult { ok: boolean; error?: string }

export async function generateStudyAction(_previous: GenerateStudyResult, formData: FormData): Promise<GenerateStudyResult> {
  const packageId = formData.get("packageId");
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: "You are signed out. Sign in, then try again." };
  if (typeof packageId !== "string" || packageId === "") return { ok: false, error: "That study guide is unavailable." };
  try {
    const owned = (await listPackagesForUser(viewer.id)).some((pkg) => pkg.id === packageId);
    if (!owned) return { ok: false, error: "That study guide is unavailable." };
    await generatePackageStudy(packageId);
    return { ok: true };
  } catch (error) {
    if (error instanceof WorkerError) {
      if (error.code === "study-generating") return { ok: false, error: "Your study guide is already being built." };
      if (error.code === "no-scored-sessions") return { ok: false, error: "Score a session before building your study guide." };
      if (error.code === "package-expired") return { ok: false, error: "This package has expired, so it cannot build new study material." };
      if (error.status === 429) return { ok: false, error: "Too many attempts just now. Wait a few minutes and try again." };
    }
    return { ok: false, error: "The study guide did not start. Try again in a moment." };
  }
}
