import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const page = readFileSync(join(root, "app/quick/report/[packageId]/page.tsx"), "utf8");

describe("quick report", () => {
  it("requires ownership and quick kind", () => {
    expect(page).toContain("listPackagesForUser(viewer.id)");
    expect(page).toContain('pkg.kind !== "quick"');
    expect(page).toContain("notFound()");
  });

  it("puts the sample warning before the shared report renderer", () => {
    expect(page.indexOf("This is a sample report")).toBeLessThan(page.indexOf("<ReportView"));
    expect(page).toContain("loadSampleReport(sampleJson)");
  });

  it("renders visitor inputs only as escaped React text and pins CTA targets", () => {
    expect(page).toContain("report at {company} looks like");
    expect(page).not.toContain("dangerouslySetInnerHTML");
    expect(page).toContain('href="/new"');
    expect(page).toContain('href="/pricing"');
  });
});
