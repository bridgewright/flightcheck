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
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/home/:path*",
    "/p/:path*",
    "/sessions/:path*",
    "/progress/:path*",
    "/rubric/:path*",
    "/packages/:path*",
    "/settings/:path*",
    "/new",
    "/dev/:path*",
  ],
};
