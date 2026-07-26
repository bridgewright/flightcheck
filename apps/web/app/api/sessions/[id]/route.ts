// No GET: session reports are served only via the token-authorized server page — do not add an unauthenticated proxy.
import { NextResponse } from "next/server";

import { authorizeSession, completeSession } from "@/lib/worker";

import { recordingStoragePath } from "../../../../lib/realtime";

// POST {action: "complete", token} → worker /api/sessions/{id}/complete,
// which flips the session to "scoring" and kicks the scoring pipeline.
//
// The recording's storage path is derived HERE from the authorized session
// row (package_id + index via recordingStoragePath) — never accepted from
// the client. A client-supplied path could point the scorer at another
// package's recording in the bucket and score a stranger's interview.
//
// The worker rejects re-scoring (409 when the session is already "scoring"
// or "scored"); that is passed through as a 409 so the client can treat it
// as already-in-progress success rather than a failure.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { action?: unknown; token?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (
    body.action !== "complete" ||
    typeof body.token !== "string" ||
    body.token === ""
  ) {
    return NextResponse.json(
      { error: 'expected {action: "complete", token}' },
      { status: 400 },
    );
  }
  // Capability check: completing a session starts a scoring run — only the
  // holder of the owning package's access token may trigger it (v0.1
  // security model).
  const access = await authorizeSession(body.token, id);
  if (!access.ok) {
    console.error(`session complete: authorizeSession failed (status ${access.status})`);
    return NextResponse.json(
      access.status === 403
        ? { error: "access denied" }
        : { error: "worker session lookup failed" },
      { status: access.status },
    );
  }
  const audioPath = recordingStoragePath(
    access.value.session.package_id,
    access.value.session.index,
  );
  try {
    const result = await completeSession(id, audioPath);
    if (result === "already-scored") {
      // Nothing new was started: the paid pipeline already ran (or is
      // running). 409 lets the client navigate on to the report.
      console.error(`session complete: worker refused a re-score (409) for a session`);
      return NextResponse.json(
        { error: "session is already scoring or scored" },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (err) {
    console.error("session complete: worker complete failed", err);
    return NextResponse.json(
      { error: "completion failed — the scoring worker did not accept the request" },
      { status: 502 },
    );
  }
}
