import { NextResponse } from "next/server";

import type { CreatePackageBody } from "@/lib/types";
import { WorkerRejectionError, createPackage } from "@/lib/worker";

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
  } catch (err) {
    if (err instanceof WorkerRejectionError) {
      // The worker rejected the input with a user-actionable message (e.g.
      // an unfetchable jd_url — SSRF guard, timeout, bot wall). Surface it
      // on the intake form instead of a generic 502. The message is generic
      // by worker contract (no echoed URL, no exception text).
      console.error(`packages create: worker rejected the input (422): ${err.message}`);
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error("packages create: worker create failed", err);
    return NextResponse.json(
      { error: "package creation failed — the scoring worker did not accept the request" },
      { status: 502 },
    );
  }
}
