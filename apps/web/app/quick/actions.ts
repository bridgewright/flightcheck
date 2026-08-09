"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getViewer } from "@/lib/viewer";
import { createQuickPackage, createSession, WorkerError } from "@/lib/worker";

export const QUICK_STASH_COOKIE = "fc_quick_stash";
const MAX_AGE_SECONDS = 10 * 60;

function clean(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 120 ? trimmed : null;
}

export async function quickStart(formData: FormData): Promise<never> {
  const company = clean(formData.get("company"));
  const role = clean(formData.get("role"));
  if (company === null || role === null) redirect("/quick?error=invalid");

  const viewer = await getViewer();
  const store = await cookies();
  if (viewer === null) {
    store.set(QUICK_STASH_COOKIE, encodeURIComponent(JSON.stringify({ company, role })), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/quick",
      maxAge: MAX_AGE_SECONDS,
    });
    redirect("/login?next=/quick");
  }

  try {
    const pkg = await createQuickPackage(viewer.id, company, role);
    const session = await createSession(pkg.package_id);
    store.delete(QUICK_STASH_COOKIE);
    redirect(`/sessions/${encodeURIComponent(session.session_id)}/room`);
  } catch (error) {
    if (error instanceof WorkerError && error.code === "quick-cap") {
      redirect("/quick?error=quick-cap");
    }
    if (error instanceof WorkerError && error.code === "package-locked") {
      redirect("/quick?error=package-locked");
    }
    if (error instanceof WorkerError && error.status === 429) {
      redirect("/quick?error=rate-limit");
    }
    throw error;
  }
}
