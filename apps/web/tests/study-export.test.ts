import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("study export", () => {
  it("pins the printable palette and attachment route", () => {
    const pdf = readFileSync(fileURLToPath(new URL("../components/StudyPdf.tsx", import.meta.url)), "utf8");
    for (const colour of ["#ffffff", "#171717", "#555555", "#333333", "#aaaaaa"]) expect(pdf).toContain(colour);
    const route = readFileSync(fileURLToPath(new URL("../app/api/study/[packageId]/route.ts", import.meta.url)), "utf8");
    expect(route).toContain("Content-Disposition");
    expect(route).toContain("application/pdf");
  });
});
