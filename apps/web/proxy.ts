// Next 16 proxy convention (the middleware file convention is deprecated).
// Refreshes the Supabase auth session on every request to a signed-in
// surface; lib/supabase/middleware.ts owns the actual cookie work.
import { type NextRequest } from "next/server";

import { updateSession } from "./lib/supabase/middleware";

export async function proxy(request: NextRequest) {
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
  ],
};
