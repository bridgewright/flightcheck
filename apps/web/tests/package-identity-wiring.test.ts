import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("../components/PackageIdentity.tsx", import.meta.url)),
  "utf-8",
);

// The component's plumbing (F-56); the render decision itself is tested in
// components/package-identity.test.ts. Pinned as source because this suite
// has no DOM harness.

describe("PackageIdentity consumes the shared rules", () => {
  it("asks the decision module, not its own re-derivation", () => {
    expect(source).toContain('from "@/components/package-identity"');
    expect(source).toContain("packageIdentityDecision(");
    // The trim/null rule lives in lib/home and the mark rule in
    // lib/company-mark, both behind the decision module; the component must
    // not reach around it.
    expect(source).not.toContain("companyMarkHost");
    expect(source).not.toContain(".trim()");
  });

  it("renders null rather than a placeholder", () => {
    expect(source).toContain("if (identity === null) return null;");
  });

  it("reuses the CompanyMark client component for the favicon", () => {
    expect(source).toContain('from "@/components/CompanyMark"');
    expect(source).toContain("identity.showMark ?");
  });

  it("dresses the chip variant in the CHIP token", () => {
    expect(source).toMatch(/import \{[^}]*\bCHIP\b[^}]*\} from "@\/lib\/ui"/);
  });
});
