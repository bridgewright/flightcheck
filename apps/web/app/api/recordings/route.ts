import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { authorizePackage } from "@/lib/worker";

import {
  MAX_RECORDING_BYTES,
  isValidPackageId,
  isValidSessionIndex,
  recordingStoragePath,
} from "../../../lib/realtime";

// Uploads the finished interview recording to the private Supabase Storage
// bucket "recordings" using the service-role key (server-only). The worker
// downloads the same path when scoring (Storage.download_recording), so the
// path shape is a registry contract, not a convention.
export async function POST(request: Request) {
  // Cheap rejection before buffering: a client announcing an oversized body
  // is turned away from the Content-Length header alone.
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RECORDING_BYTES) {
    return NextResponse.json(
      { error: "recording exceeds the 50 MB upload limit" },
      { status: 413 },
    );
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "expected multipart form data" },
      { status: 400 },
    );
  }
  const file = form.get("file");
  const packageId = form.get("packageId");
  const sessionIndex = form.get("sessionIndex");
  const token = form.get("token");
  if (
    !(file instanceof Blob) ||
    typeof packageId !== "string" ||
    packageId === "" ||
    typeof sessionIndex !== "string" ||
    typeof token !== "string" ||
    token === ""
  ) {
    return NextResponse.json(
      { error: "file, packageId, sessionIndex, and token are required" },
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
  if (file.size > MAX_RECORDING_BYTES) {
    return NextResponse.json(
      { error: "recording exceeds the 50 MB upload limit" },
      { status: 413 },
    );
  }
  // Capability check: the uploaded packageId must be the package this access
  // token unlocks (the token IS the v0.1 credential).
  const access = await authorizePackage(token);
  if (!access.ok) {
    return NextResponse.json(
      access.status === 403
        ? { error: "access denied" }
        : { error: "worker package lookup failed" },
      { status: access.status },
    );
  }
  if (access.value.id !== packageId) {
    return NextResponse.json({ error: "access denied" }, { status: 403 });
  }
  const storagePath = recordingStoragePath(packageId, index);
  const supabase = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  );
  const bytes = Buffer.from(await file.arrayBuffer());
  const { error } = await supabase.storage
    .from("recordings")
    .upload(storagePath, bytes, {
      contentType: "audio/webm",
      // A failed complete call is retried from the browser with the same
      // blob; the re-upload must overwrite, not 409.
      upsert: true,
    });
  if (error) {
    return NextResponse.json(
      { error: `storage upload failed: ${error.message}` },
      { status: 502 },
    );
  }
  return NextResponse.json({ storagePath });
}
