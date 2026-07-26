import { NextResponse } from "next/server";

import { authorizeSession, completeSession, getSession } from "@/lib/worker";

// GET: status/report polling proxy for the report flow. The worker's payload
// additionally carries session_plan and the rebuilt interviewer_instructions
// — the interview answer key. Neither may ever reach the browser, so the
// response is allow-listed to exactly the fields the report flow needs.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const row = await getSession(id);
    return NextResponse.json({
      id: row.id,
      package_id: row.package_id,
      index: row.index,
      status: row.status,
      audio_path: row.audio_path,
      report: row.report,
    });
  } catch {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
}

// POST {action: "complete", audio_path, token} → worker
// /api/sessions/{id}/complete, which flips the session to "scoring" and
// kicks the scoring pipeline.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { action?: unknown; audio_path?: unknown; token?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (
    body.action !== "complete" ||
    typeof body.audio_path !== "string" ||
    body.audio_path === "" ||
    typeof body.token !== "string" ||
    body.token === ""
  ) {
    return NextResponse.json(
      { error: 'expected {action: "complete", audio_path, token}' },
      { status: 400 },
    );
  }
  // Capability check: completing a session starts a scoring run — only the
  // holder of the owning package's access token may trigger it (v0.1
  // security model).
  const access = await authorizeSession(body.token, id);
  if (!access.ok) {
    return NextResponse.json(
      access.status === 403
        ? { error: "access denied" }
        : { error: "worker session lookup failed" },
      { status: access.status },
    );
  }
  try {
    await completeSession(id, body.audio_path);
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch {
    return NextResponse.json(
      { error: "completion failed — the scoring worker did not accept the request" },
      { status: 502 },
    );
  }
}
