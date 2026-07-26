import { NextResponse } from "next/server";

import { createSession } from "@/lib/worker";

// The worker's create-session response includes interviewer_instructions and
// session_plan — the answer key of the interview (question sequence, pressure
// probe). If either reaches the browser, the candidate can read the interview
// before taking it. This route therefore returns {session_id} ONLY and stores
// nothing; the realtime-secret route (Task 16) re-fetches the instructions
// server-side when the session actually starts.
export async function POST(request: Request) {
  let body: { package_id?: unknown };
  try {
    body = (await request.json()) as { package_id?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof body.package_id !== "string" || body.package_id === "") {
    return NextResponse.json({ error: "package_id is required" }, { status: 400 });
  }
  try {
    const created = await createSession(body.package_id);
    // Deliberate strip: session_plan and interviewer_instructions are dropped.
    return NextResponse.json({ session_id: created.session_id });
  } catch {
    return NextResponse.json(
      { error: "session creation failed — the scoring worker did not accept the request" },
      { status: 502 },
    );
  }
}
