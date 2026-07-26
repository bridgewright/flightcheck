import { NextResponse } from "next/server";

import { authorizePackage, createSession } from "@/lib/worker";

// The worker's create-session response includes interviewer_instructions and
// session_plan — the answer key of the interview (question sequence, pressure
// probe). If either reaches the browser, the candidate can read the interview
// before taking it. This route therefore returns {session_id} ONLY and stores
// nothing; the realtime-secret route (Task 16) re-fetches the instructions
// server-side when the session actually starts.
//
// Capability check: creating a session is a privileged, state-changing call
// (it plans the interview), so — like /api/recordings and /api/realtime-secret
// — the caller must hold the access token of the package it names (the v0.1
// security model). A bare package UUID is not a credential.
//
// The worker create is idempotent: v0.1 is single-session per package, and
// when the package already has its session the worker returns that existing
// session's payload again (same session_id) instead of creating another row.
// A double-click or retry therefore never spawns a second session.
export async function POST(request: Request) {
  let body: { package_id?: unknown; token?: unknown };
  try {
    body = (await request.json()) as { package_id?: unknown; token?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof body.package_id !== "string" || body.package_id === "") {
    return NextResponse.json({ error: "package_id is required" }, { status: 400 });
  }
  if (typeof body.token !== "string" || body.token === "") {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }
  const access = await authorizePackage(body.token);
  if (!access.ok) {
    console.error(`sessions create: authorizePackage failed (status ${access.status})`);
    return NextResponse.json(
      access.status === 403
        ? { error: "access denied" }
        : { error: "worker package lookup failed" },
      { status: access.status },
    );
  }
  if (access.value.id !== body.package_id) {
    console.error("sessions create: token does not unlock the requested package");
    return NextResponse.json({ error: "access denied" }, { status: 403 });
  }
  try {
    const created = await createSession(body.package_id);
    // Deliberate strip: session_plan and interviewer_instructions are dropped.
    return NextResponse.json({ session_id: created.session_id });
  } catch (err) {
    console.error("sessions create: worker create failed", err);
    return NextResponse.json(
      { error: "session creation failed — the scoring worker did not accept the request" },
      { status: 502 },
    );
  }
}
