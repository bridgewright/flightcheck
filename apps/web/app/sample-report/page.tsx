import Link from "next/link";

import ReportView from "@/components/ReportView";
import Shell from "@/components/Shell";
import { PRIMARY_BUTTON } from "@/lib/ui";
import { getViewer } from "@/lib/viewer";
import sampleJson from "@/public/sample-report.json";

import { loadSampleReport } from "./sample-data";

// S2. The one report every visitor can see without an account. Renders the
// checked-in fixture through the same ReportView the product uses; the loader
// validates the fixture and fills worker-serialized defaults so this page and
// a real report page can never quietly diverge.
const sample = loadSampleReport(sampleJson);

export default async function SampleReportPage() {
  const viewer = await getViewer();
  return (
    <Shell viewer={viewer}>
      <div className="flex flex-col gap-8">
        <div className="rounded-md border border-neutral-300 bg-neutral-50 p-4 text-sm dark:border-neutral-700 dark:bg-neutral-900">
          Sample report from a real session run by the developer. flightcheck
          has no external users yet, so no customer&rsquo;s session is on
          display here.
        </div>
        <h1 className="text-3xl font-bold tracking-tight">
          What your report looks like
        </h1>
        <ReportView report={sample.report} dimensions={sample.dimensions} />
        <div className="flex flex-col items-start gap-3 border-t border-neutral-200 pt-8 dark:border-neutral-800">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Every report is scored against a rubric compiled from the job description
            you paste — not this one.
          </p>
          <Link href="/new" className={PRIMARY_BUTTON}>
            Compile your own interview package
          </Link>
        </div>
      </div>
    </Shell>
  );
}
