import { NextResponse } from "next/server";

import { completeSession } from "@/lib/worker";

// POST {action: "complete", audio_path} → worker /api/sessions/{id}/complete,
// which flips the session to "scoring" and kicks the scoring pipeline.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { action?: unknown; audio_path?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (
    body.action !== "complete" ||
    typeof body.audio_path !== "string" ||
    body.audio_path === ""
  ) {
    return NextResponse.json(
      { error: 'expected {action: "complete", audio_path}' },
      { status: 400 },
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
