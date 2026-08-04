import { Readable } from "node:stream";

import { renderToStream } from "@react-pdf/renderer";
import ReportPdf from "@/components/ReportPdf";
import { reportMarkdown, type ReportExportMeta } from "@/lib/report-markdown";
import { sessionCapability } from "@/lib/session-capability";
import type { Rubric, SessionReport } from "@/lib/types";
import { getViewer } from "@/lib/viewer";
import { authorizeSession, authorizeViewerSession, getPackageByToken } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ sessionId: string }> };

const isoDate = (value: string | null | undefined): string => {
  if (!value) return new Date().toISOString().slice(0, 10);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? new Date().toISOString().slice(0, 10)
    : parsed.toISOString().slice(0, 10);
};

const responseError = (status: number): Response =>
  Response.json({ error: status === 403 ? "access denied" : "report unavailable" }, { status });

export async function GET(request: Request, { params }: RouteContext): Promise<Response> {
  const { sessionId } = await params;
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const viewer = token === null ? await getViewer() : null;
  if (token === null && viewer === null) return responseError(403);

  const access = token !== null
    ? await authorizeSession(token, sessionId)
    : await authorizeViewerSession(viewer!, sessionId);
  if (!access.ok) return responseError(access.status);

  const { session, pkg } = access.value;
  if (token !== null && sessionCapability(session) !== "active") return responseError(403);
  // The row's status is what decides whether there is a report to hand over,
  // because it is what the screen decides on. `eligibility` is a refinement
  // that arrived with F-04, and reports stored before it have no such key at
  // all: gating on it alone answered 404 for every report already in the
  // database, which is a thing no test with a current fixture can see.
  const report = session.report as SessionReport | null;
  const ineligible =
    report !== null && report.eligibility !== undefined && report.eligibility !== "scored";
  if (report === null || session.status !== "scored" || ineligible) {
    return responseError(404);
  }

  const packageWithRubric = pkg as typeof pkg & { rubric?: Rubric | null; role_title?: string | null };
  let rubric = packageWithRubric.rubric ?? null;
  if (rubric === null && "access_token" in pkg && typeof pkg.access_token === "string") {
    rubric = await getPackageByToken(pkg.access_token).then(
      (fullPackage) => fullPackage.rubric,
      () => null,
    );
  }
  const sessionDate = isoDate(session.created_at);
  const meta: ReportExportMeta = {
    sessionNumber: session.index,
    sessionDate,
    roleTitle: packageWithRubric.role_title ?? rubric?.role_title ?? "Interview role",
    generatedDate: new Date().toISOString().slice(0, 10),
    dimensions: (rubric?.dimensions ?? []).map((dimension) => ({
      key: dimension.key,
      name: dimension.name,
    })),
  };
  const format = url.searchParams.get("format") === "md" ? "md" : "pdf";
  const stem = `flightcheck-session-${String(session.index).padStart(2, "0")}-${sessionDate}`;

  if (format === "md") {
    return new Response(reportMarkdown(report, meta), {
      headers: {
        "Content-Disposition": `attachment; filename="${stem}.md"`,
        "Content-Type": "text/markdown; charset=utf-8",
      },
    });
  }

  const pdf = await renderToStream(ReportPdf({ report, meta }));
  const body = Readable.toWeb(pdf as Readable) as ReadableStream;
  return new Response(body, {
    headers: {
      "Content-Disposition": `attachment; filename="${stem}.pdf"`,
      "Content-Type": "application/pdf",
    },
  });
}
