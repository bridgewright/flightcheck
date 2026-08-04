import { NextResponse } from "next/server";

import { getViewer } from "@/lib/viewer";
import { authorizeViewerSession, reclaimSession, WorkerError } from "@/lib/worker";

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
    await reclaimSession(id, access.value.session.package_id, viewer.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof WorkerError) {
      return NextResponse.json(
        { error: "session cannot be reclaimed", code: error.code },
        { status: error.status },
      );
    }
    return NextResponse.json({ error: "reclaim failed" }, { status: 502 });
  }
}
