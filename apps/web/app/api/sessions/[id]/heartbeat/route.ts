import { NextResponse } from "next/server";

import { getViewer } from "@/lib/viewer";
import { authorizeViewerSession, heartbeatSession } from "@/lib/worker";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  const access = await authorizeViewerSession(viewer, id);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 403 ? "access denied" : "worker session lookup failed" },
      { status: access.status },
    );
  }
  // DECISIONS 072: a beat may carry a diagnostics-trail delta. Anything
  // else — no body, malformed JSON, a non-string field — degrades to the
  // plain beat, never to a refusal: the beat's liveness job comes first.
  let diagnostics: string | undefined;
  try {
    const body: unknown = await request.json();
    const candidate = (body as { diagnostics?: unknown } | null)?.diagnostics;
    if (typeof candidate === "string" && candidate !== "") diagnostics = candidate;
  } catch {
    // Bodyless beats are the pre-072 contract and stay valid.
  }
  try {
    await heartbeatSession(id, diagnostics);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "heartbeat failed" }, { status: 502 });
  }
}
