import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getViewer } from "@/lib/viewer";
import { authorizePackage, listPackagesForUser } from "@/lib/worker";

import {
  isValidPackageId,
  isValidSessionIndex,
  recordingStoragePath,
} from "../../../../lib/realtime";

// How long a minted playback URL stays valid. One hour covers a full read of
// the report + replay without leaving a long-lived capability in the page.
const DOWNLOAD_TTL_SECONDS = 3600;

// Mints a Supabase Storage SIGNED DOWNLOAD URL for one session recording in
// the private "recordings" bucket — the playback mirror of the upload mint.
// Same validation order as /api/recordings: format checks BEFORE any
// authorization call, authorization BEFORE any storage call.
//
// Two ways in, because the token model is being retired (URL-model decision,
// this batch): a caller holding the legacy package access token passes the
// classic capability check, and a signed-in viewer who OWNS the package (the
// account-based model the id-routed screens use) passes without a token.
// Ownership is proved the same way authorizeViewerSession proves it — the
// package must appear in the viewer's own package list.
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
    (typeof sessionIndex !== "string" && typeof sessionIndex !== "number")
  ) {
    return NextResponse.json(
      { error: "packageId and sessionIndex are required" },
      { status: 400 },
    );
  }
  // token is optional, but when present it must at least look like a token —
  // a malformed one is a bad request, not an invitation to try the other door.
  if (token !== undefined && (typeof token !== "string" || token === "")) {
    return NextResponse.json({ error: "token must be a string" }, { status: 400 });
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

  if (typeof token === "string") {
    // Legacy capability: the access token must unlock the named package.
    const access = await authorizePackage(token);
    if (!access.ok) {
      console.error(
        `recordings/download: authorizePackage failed (status ${access.status})`,
      );
      return NextResponse.json(
        access.status === 403
          ? { error: "access denied" }
          : { error: "worker package lookup failed" },
        { status: access.status },
      );
    }
    if (access.value.id !== packageId) {
      console.error("recordings/download: token does not unlock the requested package");
      return NextResponse.json({ error: "access denied" }, { status: 403 });
    }
  } else {
    // Account ownership: the signed-in viewer's own package list must contain
    // the package. A worker outage is a 502, never misreported as a denial.
    const viewer = await getViewer();
    if (!viewer) {
      return NextResponse.json({ error: "sign in first" }, { status: 401 });
    }
    let owned;
    try {
      owned = await listPackagesForUser(viewer.id);
    } catch (err) {
      console.error("recordings/download: listPackagesForUser failed", err);
      return NextResponse.json(
        { error: "worker package lookup failed" },
        { status: 502 },
      );
    }
    if (!owned.some((pkg) => pkg.id === packageId)) {
      console.error("recordings/download: viewer does not own the requested package");
      return NextResponse.json({ error: "access denied" }, { status: 403 });
    }
  }

  const storagePath = recordingStoragePath(packageId, index);
  const supabase = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  );
  const { data, error } = await supabase.storage
    .from("recordings")
    .createSignedUrl(storagePath, DOWNLOAD_TTL_SECONDS);
  if (error || !data) {
    // Log the storage detail server-side only; the client gets a generic
    // message (internal storage errors are not for the browser).
    console.error("recordings/download: createSignedUrl failed", error);
    return NextResponse.json(
      { error: "could not prepare the recording — try again" },
      { status: 502 },
    );
  }
  return NextResponse.json({ signedUrl: data.signedUrl });
}
