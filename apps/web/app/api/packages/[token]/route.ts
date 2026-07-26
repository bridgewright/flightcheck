import { NextResponse } from "next/server";

import { getPackageByToken } from "@/lib/worker";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  try {
    const row = await getPackageByToken(token);
    return NextResponse.json(row);
  } catch {
    return NextResponse.json({ error: "package not found" }, { status: 404 });
  }
}
