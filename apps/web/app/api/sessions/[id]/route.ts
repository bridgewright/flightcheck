// No GET: session reports are served only via authorized server pages — do not add an unauthenticated proxy.
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getViewer } from "@/lib/viewer";
import {
  authorizeSession,
  authorizeViewerSession,
  completeSession,
} from "@/lib/worker";

import {
  MAX_STORED_RECORDING_BYTES,
  recordingStoragePath,
} from "../../../../lib/realtime";

// Size of the uploaded object, or null when it cannot be determined.
//
// The blob never passes through a web route — the browser PUTs it straight
// to Supabase Storage with a signed URL — so this is where the server first
// sees a real byte count. createSignedUploadUrl cannot carry a size limit,
// which leaves the storage listing as the only way to ask.
async function storedRecordingBytes(storagePath: string): Promise<number | null> {
  const cut = storagePath.lastIndexOf("/");
  const supabase = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  );
  const { data, error } = await supabase.storage
    .from("recordings")
    .list(storagePath.slice(0, cut), {
      search: storagePath.slice(cut + 1),
      limit: 1,
    });
  if (error || !data?.length) {
    console.error("session complete: could not read the recording size", error);
    return null;
  }
  const size = data[0].metadata?.size;
  return typeof size === "number" ? size : null;
}

// POST {action: "complete"} → worker /api/sessions/{id}/complete, which flips
// the session to "scoring" and kicks the scoring pipeline.
//
// Authorization, one of two credentials:
// - Legacy capability: the package access token in the body (the v0.1
//   model). Still honored so token links keep working until F-10 retires
//   loose tokens.
// - Viewer ownership: no token, but a signed-in account that owns the
//   session's package — the canonical path for the id-routed session room.
//
// The recording's storage path is derived HERE from the authorized session
// row (package_id + index via recordingStoragePath) — never accepted from
// the client. A client-supplied path could point the scorer at another
// package's recording in the bucket and score a stranger's interview.
//
// The worker rejects re-scoring (409 when the session is already "scoring"
// or "scored"); that is passed through as a 409 so the client can treat it
// as already-in-progress success rather than a failure.
//
// F-12: deliberately NOT gated on the session's capability window. This is
// the last step of an interview the candidate has already sat through, and
// the recording is already in storage. A capability that lapsed at minute 19
// of a 20-minute session must never be the reason that interview is thrown
// away. Revocation stops the NEXT session — the room page and the
// secret-mint route are where it is enforced.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: { action?: unknown; token?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (body.action !== "complete") {
    return NextResponse.json(
      { error: 'expected {action: "complete"}' },
      { status: 400 },
    );
  }
  const token = typeof body.token === "string" && body.token !== "" ? body.token : null;
  let session: { package_id: string; index: number };
  let packageKind: "standard" | "quick";
  if (token !== null) {
    const access = await authorizeSession(token, id);
    if (!access.ok) {
      console.error(`session complete: authorizeSession failed (status ${access.status})`);
      return NextResponse.json(
        access.status === 403
          ? { error: "access denied" }
          : { error: "worker session lookup failed" },
        { status: access.status },
      );
    }
    session = access.value.session;
    packageKind = access.value.pkg.kind ?? "standard";
  } else {
    const viewer = await getViewer();
    if (!viewer) {
      return NextResponse.json({ error: "sign in first" }, { status: 401 });
    }
    const access = await authorizeViewerSession(viewer, id);
    if (!access.ok) {
      console.error(`session complete: authorizeViewerSession failed (status ${access.status})`);
      return NextResponse.json(
        access.status === 403
          ? { error: "access denied" }
          : { error: "worker session lookup failed" },
        { status: access.status },
      );
    }
    session = access.value.session;
    packageKind = access.value.pkg.kind ?? "standard";
  }
  const audioPath = recordingStoragePath(session.package_id, session.index);
  if (packageKind !== "quick") {
    // Quick sessions never write a recording, so probing one guarantees a
    // storage miss and a false error; skipping it keeps the unreadable-size
    // log meaningful for scored sessions.
    // Only a positively observed oversize is refused. An unreadable size fails
    // open: the interview is over and cannot be redone, so a storage hiccup
    // must never cost the customer the session they already sat through.
    const bytes = await storedRecordingBytes(audioPath);
    if (bytes !== null && bytes > MAX_STORED_RECORDING_BYTES) {
      console.error(`session complete: recording is ${bytes} bytes, over the cap`);
      return NextResponse.json(
        { error: "that recording is too large to score" },
        { status: 413 },
      );
    }
  }
  try {
    const result = await completeSession(id, audioPath);
    if (result === "already-scored") {
      // Nothing new was started: the paid pipeline already ran (or is
      // running). 409 lets the client navigate on to the report.
      console.error("session complete: worker refused a re-score (409)");
      return NextResponse.json(
        { error: "session is already scoring or scored" },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (err) {
    console.error("session complete: worker complete failed", err);
    return NextResponse.json(
      { error: "completion failed: the scoring worker did not accept the request" },
      { status: 502 },
    );
  }
}
