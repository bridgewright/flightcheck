// No GET: session reports are served only via authorized server pages — do not add an unauthenticated proxy.
import { NextResponse } from "next/server";

import { getViewer } from "@/lib/viewer";
import {
  authorizeSession,
  authorizeViewerSession,
  completeSession,
} from "@/lib/worker";

import { recordingStoragePath } from "../../../../lib/realtime";

// POST {action: "complete"} → worker /api/sessions/{id}/complete, which flips
// the session to "scoring" and kicks the scoring pipeline.
//
// Authorization, one of two credentials:
// - Legacy capability: the package access token in the body (the v0.1
//   model). Still honored so token links keep working until F-10 retires
//   loose tokens.
// - Viewer ownership: no token, but a signed-in account that owns the
//   session's package — the canonical path for the id-routed session room.
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
  if (body.action !== "complete") {
    return NextResponse.json(
      { error: 'expected {action: "complete"}' },
      { status: 400 },
    );
  }
  const token = typeof body.token === "string" && body.token !== "" ? body.token : null;
  let session: { package_id: string; index: number };
  if (token !== null) {
    const access = await authorizeSession(token, id);
    if (!access.ok) {
      console.error(`session complete: authorizeSession failed (status ${access.status})`);
      return NextResponse.json(
        access.status === 403
          ? { error: "access denied" }
          : { error: "worker session lookup failed" },
        { status: access.status },
      );
    }
    session = access.value.session;
  } else {
    const viewer = await getViewer();
    if (!viewer) {
      return NextResponse.json({ error: "sign in first" }, { status: 401 });
    }
    const access = await authorizeViewerSession(viewer, id);
    if (!access.ok) {
      console.error(`session complete: authorizeViewerSession failed (status ${access.status})`);
      return NextResponse.json(
        access.status === 403
          ? { error: "access denied" }
          : { error: "worker session lookup failed" },
        { status: access.status },
      );
    }
    session = access.value.session;
  }
  const audioPath = recordingStoragePath(session.package_id, session.index);
  try {
    const result = await completeSession(id, audioPath);
    if (result === "already-scored") {
      // Nothing new was started: the paid pipeline already ran (or is
      // running). 409 lets the client navigate on to the report.
      console.error("session complete: worker refused a re-score (409)");
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
