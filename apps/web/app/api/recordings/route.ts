import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { recordingStoragePath } from "../../../lib/realtime";

// Uploads the finished interview recording to the private Supabase Storage
// bucket "recordings" using the service-role key (server-only). The worker
// downloads the same path when scoring (Storage.download_recording), so the
// path shape is a registry contract, not a convention.
export async function POST(request: Request) {
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
  if (
    !(file instanceof Blob) ||
    typeof packageId !== "string" ||
    packageId === "" ||
    typeof sessionIndex !== "string"
  ) {
    return NextResponse.json(
      { error: "file, packageId, and sessionIndex are required" },
      { status: 400 },
    );
  }
  const index = Number(sessionIndex);
  if (!Number.isInteger(index) || index < 1) {
    return NextResponse.json(
      { error: "sessionIndex must be a positive integer" },
      { status: 400 },
    );
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
