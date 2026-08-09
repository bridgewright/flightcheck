import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { NAV_TABS } from "@/lib/home";

const source = readFileSync(
  fileURLToPath(new URL("../app/home/page.tsx", import.meta.url)),
  "utf8",
);

describe("home dashboard progress wiring", () => {
  it("pins the section tabs and their tour anchors", () => {
    expect(NAV_TABS).toEqual([
      { href: "/home", label: "Home", tour: "nav-home" },
      { href: "/sessions", label: "Sessions", tour: "nav-sessions" },
      { href: "/progress", label: "Progress", tour: "nav-progress" },
      { href: "/rubric", label: "Role & Rubric", tour: "nav-rubric" },
    ]);
  });

  it("keeps the tour mounts and home anchors stable", () => {
    expect(source.match(/<HomeTour \/>/g)).toHaveLength(2);
    expect(source).toContain('data-tour="primary-action"');
    expect(source).toContain('data-tour="progress"');
  });

  it("loads progress additively with a catch-to-null", () => {
    // `[^}]` rather than `[\s\S]`: the lazy any-character version matched
    // across whole import blocks, so it stayed green with getPackageProgress
    // imported from an entirely different module as long as some later import
    // closed on "@/lib/worker".
    expect(source).toMatch(
      /import \{[^}]*?\bgetPackageProgress\b[^}]*?\} from "@\/lib\/worker"/,
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
