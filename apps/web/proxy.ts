// Next 16 proxy convention (the middleware file convention is deprecated).
// Refreshes the Supabase auth session on every request to a signed-in
// surface; lib/supabase/middleware.ts owns the actual cookie work.
import { NextResponse, type NextRequest } from "next/server";

import { updateSession } from "./lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  // Dev-only fixture routes must not exist in production. Blocked here, not
  // in the page: streaming (app-level loading.tsx) flushes a 200 before a
  // page-level notFound() can set the status; the proxy runs before render.
  if (request.nextUrl.pathname.startsWith("/dev")) {
    if (process.env.NODE_ENV === "production") {
      return new NextResponse(null, { status: 404 });
    }
    return NextResponse.next();
  }
  const response = await updateSession(request);
  // API calls get the cookie refresh but never the login redirect: every
  // /api handler does its own auth, and some callers (the Polar webhook)
  // are servers with no cookies at all — an HTML redirect would break them.
  // updateSession only redirects when there is no user, in which case there
  // were no cookies to refresh either, so plain pass-through loses nothing.
  if (
    request.nextUrl.pathname.startsWith("/api") &&
    response.headers.has("location")
  ) {
    return NextResponse.next();
  }
  return response;
}

export const config = {
  matcher: [
    "/feedback",
    "/home/:path*",
    "/p/:path*",
    "/sessions/:path*",
    "/progress/:path*",
    "/study",
    "/ops/:path*",
    "/rubric/:path*",
    "/packages/:path*",
    "/settings/:path*",
    "/new",
    "/dev/:path*",
    // Supabase cookie refresh must also cover API calls, or a long-idle tab
    // whose first request is an API call (poll, upload) acts signed-out.
    // The matcher stays an include-list, so static assets remain excluded.
    "/api/:path*",
  ],
};
