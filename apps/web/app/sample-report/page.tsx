import type { Metadata } from "next";
import Link from "next/link";

import ReportView from "@/components/ReportView";
import Shell from "@/components/Shell";
import { DIVIDER, MUTED, NOTICE, PAGE_HEADING, PRIMARY_BUTTON } from "@/lib/ui";
import { getViewer } from "@/lib/viewer";
import sampleJson from "@/public/sample-report.json";

import { publicMetadata } from "../site";
import { loadSampleReport } from "./sample-data";

// S2. The one report every visitor can see without an account. Renders the
// checked-in fixture through the same ReportView the product uses; the loader
// validates the fixture and fills worker-serialized defaults so this page and
// a real report page can never quietly diverge.
const sample = loadSampleReport(sampleJson);

// The most-shared link this product has: it is the whole product, visible
// without signing up, which is exactly what a reviewer wants to click.
export const metadata: Metadata = publicMetadata({
  path: "/sample-report",
  title: "A real scored report: flightcheck",
  description:
    "What you get after a session: content and delivery scored separately, " +
    "with your own words quoted as evidence, and an honest verdict.",
});

export default async function SampleReportPage() {
  const viewer = await getViewer();
  return (
    <Shell viewer={viewer}>
      <div className="flex flex-col gap-8">
        <div className={NOTICE}>
          Sample report from a real session run by the developer. flightcheck
          has no external users yet, so no customer&rsquo;s session is on
          display here.
        </div>
        <h1 className={PAGE_HEADING}>
          What your report looks like
        </h1>
        <ReportView report={sample.report} dimensions={sample.dimensions} />
        <div className={`${DIVIDER} flex flex-col items-start gap-3 border-t pt-8`}>
          <p className={`${MUTED} text-sm`}>
            Every report is scored against a rubric compiled from the job description
            you paste, not this one.
          </p>
          <Link href="/new" className={PRIMARY_BUTTON}>
            Compile your own interview package
          </Link>
        </div>
      </div>
    </Shell>
  );
}
