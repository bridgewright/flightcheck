import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getViewer } from "@/lib/viewer";

// Claims an unclaimed package for the signed-in account, so a token link
// opened while logged in shows up on /home from then on.
//
// The owner is taken from the session and never from the request body: a
// caller who could name the owner could hand any loose package to any account.
// The `user_id is null` predicate is the other half of that guard — a package
// that already belongs to someone is never reassigned, so forwarding a link
// cannot take it away from them.
export async function POST(request: Request) {
  let body: { token?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { token } = body;
  if (typeof token !== "string" || token === "") {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }
  const viewer = await getViewer();
  if (!viewer) {
    return NextResponse.json({ error: "sign in first" }, { status: 401 });
  }
  const supabase = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  );
  const { data, error } = await supabase
    .from("packages")
    .update({ user_id: viewer.id })
    .eq("access_token", token)
    .is("user_id", null)
    .select("id");
  if (error) {
    // The database detail stays server-side; the caller gets a generic message.
    console.error("packages/bind: update failed", error);
    return NextResponse.json(
      { error: "could not claim this package" },
      { status: 502 },
    );
  }
  // bound:false is the ordinary "already claimed or unknown token" outcome,
  // not an error — the page that calls this does not change what it renders.
  return NextResponse.json({ bound: (data?.length ?? 0) > 0 });
}
