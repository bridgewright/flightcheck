import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { authorizePackage, listSessions } from "@/lib/worker";

import {
  isValidPackageId,
  isValidSessionIndex,
  recordingStoragePath,
} from "../../../lib/realtime";

// Mints a Supabase Storage SIGNED UPLOAD URL for one session recording in
// the private "recordings" bucket, using the service-role key (server-only).
// The browser then PUTs the blob straight to Supabase with that URL, so the
// multi-megabyte recording never passes through a Vercel function — whose
// ~4.5 MB request-body limit a real 20-minute opus recording (~1 MB/min)
// would exceed. It also means this route never buffers a hostile body.
//
// The storage path is derived server-side (recordingStoragePath) after the
// token capability check; the worker downloads the same path when scoring
// (Storage.download_recording), so the path shape is a registry contract,
// not a convention.
export async function POST(request: Request) {
  let body: { packageId?: unknown; sessionIndex?: unknown; token?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { packageId, sessionIndex, token } = body;
  if (
    typeof packageId !== "string" ||
    packageId === "" ||
    (typeof sessionIndex !== "string" && typeof sessionIndex !== "number") ||
    typeof token !== "string" ||
    token === ""
  ) {
    return NextResponse.json(
      { error: "packageId, sessionIndex, and token are required" },
      { status: 400 },
    );
  }
  // Format validation BEFORE storage-key interpolation: the storage path
  // embeds packageId and sessionIndex, so only a canonical UUID and a small
  // positive integer may pass (no path traversal into the bucket).
  if (!isValidPackageId(packageId)) {
    return NextResponse.json(
      { error: "packageId must be a UUID" },
      { status: 400 },
    );
  }
  const index = Number(sessionIndex);
  if (!isValidSessionIndex(index)) {
    return NextResponse.json(
      { error: "sessionIndex must be a small positive integer" },
      { status: 400 },
    );
  }
  // Capability check: the requested packageId must be the package this access
  // token unlocks (the token IS the v0.1 credential).
  const access = await authorizePackage(token);
  if (!access.ok) {
    console.error(`recordings: authorizePackage failed (status ${access.status})`);
    return NextResponse.json(
      access.status === 403
        ? { error: "access denied" }
        : { error: "worker package lookup failed" },
      { status: access.status },
    );
  }
  if (access.value.id !== packageId) {
    console.error("recordings: token does not unlock the requested package");
    return NextResponse.json({ error: "access denied" }, { status: 403 });
  }
  // Blob-swap guard (v0.5): once the session at this index is scoring or
  // scored, its recording is scoring evidence — an upsert upload URL minted
  // now would let a token holder overwrite the audio AFTER the score
  // exists. Retry paths stay open: a planned session whose complete call
  // failed, and failed/insufficient sessions whose slot is reattempted, are
  // exactly the honest re-upload cases the upsert exists for.
  let sessions;
  try {
    sessions = await listSessions(packageId);
  } catch (err) {
    // Fail closed: with the session state unknowable, minting could enable
    // the swap this guard exists to stop — and the upload retry needs the
    // worker reachable moments later for /complete anyway.
    console.error("recordings: session listing failed", err);
    return NextResponse.json(
      { error: "worker session lookup failed" },
      { status: 502 },
    );
  }
  const session = sessions.find((row) => row.index === index);
  if (session && (session.status === "scoring" || session.status === "scored")) {
    return NextResponse.json(
      {
        error:
          "this session has already been submitted for scoring — its recording can no longer be replaced",
      },
      { status: 409 },
    );
  }
  const storagePath = recordingStoragePath(packageId, index);
  const supabase = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  );
  // upsert: a failed complete call is retried from the browser with the same
  // blob; the re-upload must overwrite, not 409.
  const { data, error } = await supabase.storage
    .from("recordings")
    .createSignedUploadUrl(storagePath, { upsert: true });
  if (error || !data) {
    // Log the storage detail server-side only; the client gets a generic
    // message (internal storage errors are not for the browser).
    console.error("recordings: createSignedUploadUrl failed", error);
    return NextResponse.json(
      { error: "could not prepare the upload — try again" },
      { status: 502 },
    );
  }
  return NextResponse.json({ signedUrl: data.signedUrl });
}
