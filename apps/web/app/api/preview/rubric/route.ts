import { NextResponse } from "next/server";

import { WorkerError, previewRubric } from "@/lib/worker";

import {
  FixedWindow,
  PREVIEW_JD_MAX_CHARS,
  PREVIEW_JD_MIN_CHARS,
  PREVIEW_PER_IP,
  PREVIEW_WINDOW_MS,
  clientKey,
} from "../guard";
import { refusalFor } from "../refusals";
import type { PreviewRefusal } from "../refusals";

// The landing page's rubric preview (F-45) — the only route in this app that
// an anonymous visitor can use to make the product spend money.
//
// It exists because the most useful thing we can show someone who has never
// signed up is the bar they would be measured against, and because no
// candidate-side product does that today. It is also, for exactly the same
// reason, the surface most worth abusing, so it is guarded on both sides of
// the hop: this layer holds the per-visitor window (only this layer can see
// the visitor), and the worker holds the JD cap, a service-level burst
// window, the global daily ceiling, a concurrency slot, and a hard deadline.
//
// The worker token stays server-side — this route is the whole reason the
// browser never needs one. Nothing about the worker (host, status text, error
// body) reaches the response; every failure becomes one of the typed
// refusals in ../refusals.ts, which is also where the copy lives.
//
// Nothing is persisted anywhere in this path. A preview is a look, not an
// account.

export const dynamic = "force-dynamic";

// Module scope, so the window survives between requests on a warm instance.
// Serverless means several instances and therefore several counters; that is
// understood and is why the worker's daily ceiling is the durable backstop
// rather than this.
const visitors = new FixedWindow(PREVIEW_WINDOW_MS, PREVIEW_PER_IP);

function refuse(refusal: PreviewRefusal): NextResponse {
  return NextResponse.json(
    { error: refusal.error, code: refusal.code },
    { status: refusal.status, headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: { jd_text?: unknown };
  try {
    body = (await request.json()) as { jd_text?: unknown };
  } catch {
    return NextResponse.json(
      { error: "invalid JSON body", code: "bad-request" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  if (typeof body.jd_text !== "string") {
    return NextResponse.json(
      { error: "jd_text is required", code: "bad-request" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  // Length first, and before the rate-limit window: a paste that can never
  // produce a preview should not cost the visitor one of their tries.
  const jdText = body.jd_text.trim();
  if (jdText.length < PREVIEW_JD_MIN_CHARS) {
    return refuse(refusalFor("preview-too-short"));
  }
  if (jdText.length > PREVIEW_JD_MAX_CHARS) {
    return refuse(refusalFor("preview-too-long"));
  }
  if (!visitors.hit(clientKey(request.headers))) {
    return refuse(refusalFor("preview-rate-limited"));
  }

  try {
    const preview = await previewRubric(jdText);
    return NextResponse.json(preview, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof WorkerError) {
      // The worker's refusals are the honest degraded states this feature
      // ships with (busy, over the ceiling, timed out). Carry the CODE across
      // the hop so the widget can switch on it; the sentence is ours.
      console.error(
        `preview: worker refused (${err.status} ${err.code})`,
      );
      return refuse(refusalFor(err.code));
    }
    // A transport failure, an unconfigured worker, anything else. The message
    // can carry hostnames and header values, so it is logged and dropped.
    console.error("preview: worker call failed", err);
    return refuse(refusalFor("preview-failed"));
  }
}
