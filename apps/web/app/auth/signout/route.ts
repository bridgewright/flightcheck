import { NextResponse } from "next/server";

import { safeNextPath } from "../../../lib/auth-redirect";
import { createClient } from "../../../lib/supabase/server";

// Signs the account out and redirects. The optional `next` form field exists
// for the S15 403 page: its "Switch account" form must land back on the
// package link (via login) so the user re-enters as the account that owns
// it. Every other signout form omits the field and keeps landing on "/".
//
// `next` is attacker-reachable, so it passes only when safeNextPath accepts
// it verbatim — same-origin paths only; anything absolute, protocol-relative,
// or empty falls back to "/".
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const rawNext = form?.get("next");
  const next =
    typeof rawNext === "string" && safeNextPath(rawNext) === rawNext
      ? rawNext
      : "/";
  const supabase = await createClient();
  await supabase.auth.signOut();
  // 303: after a form POST the browser must follow with a GET.
  return NextResponse.redirect(new URL(next, request.url), 303);
}
