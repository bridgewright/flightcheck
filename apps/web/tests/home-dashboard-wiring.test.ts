import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("../app/home/page.tsx", import.meta.url)),
  "utf8",
);

describe("home dashboard progress wiring", () => {
  it("loads progress additively with a catch-to-null", () => {
    expect(source).toMatch(
      /import \{[\s\S]*?\bgetPackageProgress\b[\s\S]*?\} from "@\/lib\/worker"/,
    );
    expect(source).toMatch(/getPackageProgress\(active\.id\)\.catch\(\(\) => null\)/);
  });

  it("composes the glance-level progress components", () => {
    expect(source).toContain("<OverallTrend");
    expect(source).toContain("<ProgressDimensionTable");
    expect(source).toContain("<ProgressFocus");
  });

  it("keeps detail-only progress components off home", () => {
    expect(source).not.toContain('from "@/components/ProgressTrajectory"');
    expect(source).not.toContain('from "@/components/ProgressDeliveryTable"');
  });

  it("gates the section on the shared visibility rule", () => {
    expect(source).toContain("trendSectionVisible(progress.sessions)");
  });
});
