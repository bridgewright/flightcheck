import { Readable } from "node:stream";

import { renderToStream } from "@react-pdf/renderer";
import StudyPdf from "@/components/StudyPdf";
import { qaSets, sessionStudyMarkdown, type SessionStudyMeta } from "@/lib/session-study";
import { deriveSessionDetailState } from "@/lib/transcript";
import type { SessionCoaching } from "@/lib/types";
import { getViewer } from "@/lib/viewer";
import { authorizeViewerSession, getSessionCoaching, getSessionTranscript } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ sessionId: string }> };

const isoDate = (value: string | null | undefined): string => {
  if (!value) return new Date().toISOString().slice(0, 10);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString().slice(0, 10) : parsed.toISOString().slice(0, 10);
};

const responseError = (status: number): Response =>
  Response.json({ error: status === 403 ? "access denied" : "study unavailable" }, { status });

export async function GET(request: Request, { params }: RouteContext): Promise<Response> {
  const { sessionId } = await params;
  const viewer = await getViewer();
  if (viewer === null) return responseError(403);
  const access = await authorizeViewerSession(viewer, sessionId);
  if (!access.ok) return responseError(access.status);
  const { session, pkg } = access.value;
  const state = deriveSessionDetailState(session);
  if (state !== "scored" && state !== "limited") return responseError(404);

  let coaching: SessionCoaching;
  try {
    coaching = await getSessionCoaching(sessionId);
  } catch {
    return responseError(404);
  }
  const segments = await getSessionTranscript(sessionId).catch(() => null);
  const sets = qaSets(segments ?? [], coaching);
  const insights = coaching.insights;
  if (sets.length === 0 && insights === null) return responseError(404);

  const sessionDate = isoDate(session.created_at);
  const meta: SessionStudyMeta = {
    sessionNumber: session.index,
    sessionDate,
    roleTitle: pkg.role_title ?? null,
    generatedDate: new Date().toISOString().slice(0, 10),
  };
  const stem = `flightcheck-session-${String(session.index).padStart(2, "0")}-study-${sessionDate}`;
  const format = new URL(request.url).searchParams.get("format") === "md" ? "md" : "pdf";
  if (format === "md") {
    return new Response(sessionStudyMarkdown(sets, insights, meta), { headers: {
      "Content-Disposition": `attachment; filename="${stem}.md"`,
      "Content-Type": "text/markdown; charset=utf-8",
    } });
  }
  const pdf = await renderToStream(StudyPdf({ sets, insights, meta }));
  const body = Readable.toWeb(pdf as Readable) as ReadableStream;
  return new Response(body, { headers: {
    "Content-Disposition": `attachment; filename="${stem}.pdf"`,
    "Content-Type": "application/pdf",
  } });
}
