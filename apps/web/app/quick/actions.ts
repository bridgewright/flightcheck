"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getViewer } from "@/lib/viewer";
import { createQuickPackage, createSession, WorkerError } from "@/lib/worker";
import {
  QUICK_FIELD_MAX_CHARS,
  QUICK_STASH_COOKIE,
  QUICK_STASH_MAX_AGE_S,
  QUICK_STASH_PATH,
  encodeStash,
} from "./stash";

function clean(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= QUICK_FIELD_MAX_CHARS
    ? trimmed
    : null;
}

export async function quickStart(formData: FormData): Promise<never> {
  const company = clean(formData.get("company"));
  const role = clean(formData.get("role"));
  if (company === null || role === null) redirect("/quick?error=invalid");

  const viewer = await getViewer();
  const store = await cookies();
  if (viewer === null) {
    store.set(QUICK_STASH_COOKIE, encodeStash({ company, role }), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: QUICK_STASH_PATH,
      maxAge: QUICK_STASH_MAX_AGE_S,
    });
    redirect("/login?next=/quick");
  }

  try {
    const pkg = await createQuickPackage(viewer.id, company, role);
    const session = await createSession(pkg.package_id);
    // Same path it was set with. A bare delete(name) serializes without one,
    // which expires a cookie at the default path and leaves this one alone.
    store.delete({ name: QUICK_STASH_COOKIE, path: QUICK_STASH_PATH });
    redirect(`/sessions/${encodeURIComponent(session.session_id)}/room`);
  } catch (error) {
    // The worker's two honest refusals. `package-locked` is deliberately NOT
    // among them: it guards sessions on an unpaid STANDARD package, and quick
    // packages skip that check, so a quick start cannot raise it. Copy for it
    // told the visitor to unlock or remove their package before trying the
    // free interview — a rule the product does not have, telling someone one
    // step from paying to pay first, or to delete a compiled package, to see
    // a five-minute demo.
    if (error instanceof WorkerError && error.code === "quick-cap") {
      redirect("/quick?error=quick-cap");
    }
    if (error instanceof WorkerError && error.status === 429) {
      redirect("/quick?error=rate-limit");
    }
    throw error;
  }
}
