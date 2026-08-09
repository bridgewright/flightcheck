import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { loadSampleReport } from "@/app/sample-report/sample-data";
import { publicMetadata } from "@/app/site";
import ReportView from "@/components/ReportView";
import Shell from "@/components/Shell";
import { DIVIDER, NOTICE, PAGE_HEADING, PRIMARY_BUTTON, SECONDARY_BUTTON, SUB_HEADING } from "@/lib/ui";
import { getViewer } from "@/lib/viewer";
import { listPackagesForUser } from "@/lib/worker";
import sampleJson from "@/public/sample-report.json";

const sample = loadSampleReport(sampleJson);

export const metadata: Metadata = publicMetadata({
  path: "/quick/report",
  title: "Quick interview sample report: flightcheck",
  description: "A sample of the scored report included with a full interview package.",
});

export default async function QuickReportPage({ params }: { params: Promise<{ packageId: string }> }) {
  const { packageId } = await params;
  const viewer = await getViewer();
  if (viewer === null) redirect(`/login?next=${encodeURIComponent(`/quick/report/${packageId}`)}`);
  const packages = await listPackagesForUser(viewer.id);
  const pkg = packages.find((item) => item.id === packageId);
  if (pkg === undefined || pkg.kind !== "quick") notFound();

  const company = pkg.quick_company?.trim() || "your target company";
  const role = pkg.quick_role?.trim() || "your target role";
  return (
    <Shell viewer={viewer} packages={packages}>
      <div className="flex flex-col gap-8">
        <div className={NOTICE}>
          This is a sample report. The quick interview is not scored. Buy a package and every part of the report becomes personal to you.
        </div>
        <h1 className={PAGE_HEADING}>What a scored {role} report at {company} looks like</h1>
        <ReportView report={sample.report} dimensions={sample.dimensions} />
        <section className={`${DIVIDER} flex flex-col gap-5 border-t pt-8`}>
          <h2 className={SUB_HEADING}>What the package unlocks</h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>A rubric compiled from the real job description</li>
            <li>Six 20-minute scored sessions</li>
            <li>Per-answer coaching</li>
            <li>Study notes</li>
            <li>Progress trends</li>
          </ul>
          <div className="flex flex-wrap gap-3">
            <Link href="/new" className={PRIMARY_BUTTON}>Register the real job description</Link>
            <Link href="/pricing" className={SECONDARY_BUTTON}>See pricing</Link>
          </div>
        </section>
      </div>
    </Shell>
  );
}
