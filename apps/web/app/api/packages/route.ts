import { NextResponse } from "next/server";

import type { CreatePackageBody } from "@/lib/types";
import { createPackage } from "@/lib/worker";

export async function POST(request: Request) {
  let body: CreatePackageBody;
  try {
    body = (await request.json()) as CreatePackageBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.jd_text && !body.jd_url) {
    return NextResponse.json({ error: "jd_text or jd_url is required" }, { status: 400 });
  }
  try {
    const created = await createPackage(body);
    return NextResponse.json(created, { status: 202 });
  } catch {
    return NextResponse.json(
      { error: "package creation failed — the scoring worker did not accept the request" },
      { status: 502 },
    );
  }
}
