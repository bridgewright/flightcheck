import { Readable } from "node:stream";
import { renderToStream } from "@react-pdf/renderer";
import StudyPdf from "@/components/StudyPdf";
import { studyExportFilename } from "@/components/study-view";
import { studyMarkdown } from "@/lib/study-markdown";
import { getViewer } from "@/lib/viewer";
import { getPackageBookmarks, getPackageByToken, getPackageStudy, listPackagesForUser } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ packageId: string }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  const viewer = await getViewer();
  if (!viewer) return Response.json({ error: "authentication required" }, { status: 401 });
  const { packageId } = await params;
  const packages = await listPackagesForUser(viewer.id).catch(() => []);
  const owned = packages.find((pkg) => pkg.id === packageId);
  if (!owned) return Response.json({ error: "study unavailable" }, { status: 404 });
  const [study, bookmarks, fullPackage] = await Promise.all([
    getPackageStudy(packageId).catch(() => null),
    getPackageBookmarks(packageId).catch(() => null),
    getPackageByToken(owned.access_token).catch(() => null),
  ]);
  if (!study?.doc || study.status !== "ready" || !study.generated_at) return Response.json({ error: "study unavailable" }, { status: 404 });
  const meta = { roleTitle: fullPackage?.rubric?.role_title ?? owned.role_title, generatedAt: study.generated_at };
  const stem = studyExportFilename(study.generated_at);
  if (new URL(request.url).searchParams.get("format") === "md") return new Response(studyMarkdown(study.doc, bookmarks, meta), { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${stem}.md"` } });
  const pdf = await renderToStream(StudyPdf({ doc: study.doc, bookmarks, meta }));
  return new Response(Readable.toWeb(pdf as Readable) as ReadableStream, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${stem}.pdf"` } });
}
