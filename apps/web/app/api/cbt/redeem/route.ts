import { NextResponse } from "next/server";

import { getViewer } from "@/lib/viewer";
import { redeemCbtCode, WorkerError } from "@/lib/worker";

export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ code: "unauthorized" }, { status: 401 });

  let body: { code?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "invalid" }, { status: 422 });
  }
  if (typeof body.code !== "string") {
    return NextResponse.json({ code: "invalid" }, { status: 422 });
  }

  try {
    return NextResponse.json(await redeemCbtCode(viewer.id, body.code.trim()));
  } catch (error) {
    if (error instanceof WorkerError) {
      return NextResponse.json({ code: error.code }, { status: error.status });
    }
    return NextResponse.json({ code: "unknown" }, { status: 502 });
  }
}
