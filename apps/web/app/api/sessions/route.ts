import { NextResponse } from "next/server";

import { getViewer } from "@/lib/viewer";
import { authorizePackage, createSession, listPackagesForUser } from "@/lib/worker";

// The worker's create-session response includes interviewer_instructions and
// session_plan — the answer key of the interview (question sequence, pressure
// probe). If either reaches the browser, the candidate can read the interview
// before taking it. This route therefore returns {session_id} ONLY and stores
// nothing; the realtime-secret route re-fetches the instructions server-side
// when the session actually starts.
//
// Authorization, one of two credentials:
// - Legacy capability: the package access token in the body (the v0.1
//   model). Still honored so token links keep working until F-10 retires
//   loose tokens.
// - Viewer ownership: no token, but a signed-in account whose packages
//   include the named one. The canonical path for the id-routed screens —
//   the browser never needs to see the token. A bare package UUID is not a
//   credential either way.
export async function POST(request: Request) {
  let body: { package_id?: unknown; token?: unknown };
  try {
    body = (await request.json()) as { package_id?: unknown; token?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof body.package_id !== "string" || body.package_id === "") {
    return NextResponse.json({ error: "package_id is required" }, { status: 400 });
  }
  const token = typeof body.token === "string" && body.token !== "" ? body.token : null;
  if (token !== null) {
    const access = await authorizePackage(token);
    if (!access.ok) {
      console.error(`sessions create: authorizePackage failed (status ${access.status})`);
      return NextResponse.json(
        access.status === 403
          ? { error: "access denied" }
          : { error: "worker package lookup failed" },
        { status: access.status },
      );
    }
    if (access.value.id !== body.package_id) {
      console.error("sessions create: token does not unlock the requested package");
      return NextResponse.json({ error: "access denied" }, { status: 403 });
    }
  } else {
    const viewer = await getViewer();
    if (!viewer) {
      return NextResponse.json({ error: "sign in first" }, { status: 401 });
    }
    let packages;
    try {
      packages = await listPackagesForUser(viewer.id);
    } catch (err) {
      // An unreachable worker is an outage, never a denial.
      console.error("sessions create: package ownership lookup failed", err);
      return NextResponse.json(
        { error: "worker package lookup failed" },
        { status: 502 },
      );
    }
    if (!packages.some((pkg) => pkg.id === body.package_id)) {
      console.error("sessions create: viewer does not own the requested package");
      return NextResponse.json({ error: "access denied" }, { status: 403 });
    }
  }
  try {
    const created = await createSession(body.package_id);
    // Deliberate strip: session_plan and interviewer_instructions are dropped.
    return NextResponse.json({ session_id: created.session_id });
  } catch (err) {
    console.error("sessions create: worker create failed", err);
    return NextResponse.json(
      { error: "session creation failed — the scoring worker did not accept the request" },
      { status: 502 },
    );
  }
}
