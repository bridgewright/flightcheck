import Link from "next/link";

import ReportView, { type DimensionMeta } from "@/components/ReportView";
import type { SessionReport } from "@/lib/types";
import sampleJson from "@/public/sample-report.json";

const sample = sampleJson as unknown as {
  report: SessionReport;
  dimensions: DimensionMeta[];
};

export default function SampleReportPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
      <div className="rounded-md border border-neutral-300 bg-neutral-50 p-4 text-sm dark:border-neutral-700 dark:bg-neutral-900">
        Sample report from a real practice session (anonymized).
      </div>
      <h1 className="text-3xl font-bold tracking-tight">What your report looks like</h1>
      <ReportView report={sample.report} dimensions={sample.dimensions} />
      <p className="text-sm">
        <Link href="/new" className="underline underline-offset-4">
          Compile your own interview package
        </Link>{" "}
        &mdash; no signup needed to view this sample.
      </p>
    </main>
  );
}
