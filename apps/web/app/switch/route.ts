import { NextResponse } from "next/server";

import { safeNextPath } from "@/lib/auth-redirect";
import { ACTIVE_PACKAGE_COOKIE } from "@/lib/home";
import { getViewer } from "@/lib/viewer";
import { listPackagesForUser } from "@/lib/worker";

// GET /switch?pkg=<id>&next=<path> — the one writer of the active-package
// cookie. Every switcher entry and package-card "Open" navigates through
// here: prove the signed-in viewer owns the package, remember it, bounce
// back. The pkg parameter is a hint, not a capability — an id the viewer
// does not own is simply ignored (no cookie), and real authorization still
// happens on whatever screen renders next.
//
// Kept out of the proxy matcher on purpose: the handler owns its own
// signed-out redirect so the round-trip through /login lands back here and
// the switch still happens after sign-in.

// A year: switching packages is a deliberate act, so the choice should
// outlive the browser session it was made in.
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const viewer = await getViewer();
  if (!viewer) {
    const login = new URL("/login", url);
    login.searchParams.set("next", `${url.pathname}${url.search}`);
    return NextResponse.redirect(login);
  }

  const next = safeNextPath(url.searchParams.get("next"));
  const response = NextResponse.redirect(new URL(next, url));
  const pkg = url.searchParams.get("pkg");
  if (!pkg) {
    return response;
  }

  let owned;
  try {
    owned = await listPackagesForUser(viewer.id);
  } catch {
    // The destination page renders its own unreachable state; failing the
    // navigation here would just add a second, worse error surface.
    return response;
  }
  if (owned.some((candidate) => candidate.id === pkg)) {
    response.cookies.set(ACTIVE_PACKAGE_COOKIE, pkg, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: COOKIE_MAX_AGE_S,
    });
  }
  return response;
}
