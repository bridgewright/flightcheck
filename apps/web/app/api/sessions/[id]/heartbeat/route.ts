import { NextResponse } from "next/server";

import { getViewer } from "@/lib/viewer";
import { authorizeViewerSession, heartbeatSession } from "@/lib/worker";

export async function POST(
  _request: Request,
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
  try {
    await heartbeatSession(id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "heartbeat failed" }, { status: 502 });
  }
}
