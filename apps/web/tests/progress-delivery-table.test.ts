import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(
    new URL("../components/ProgressDeliveryTable.tsx", import.meta.url),
  ),
  "utf-8",
);

// The delivery-trends rows themselves (labels, order, units, the
// dash-for-missing rule) are tested in components/progress-delivery.test.ts.
// There is no DOM harness in this suite, so the wiring a renderer would
// assert is pinned as source instead, the light-dismiss-client.test.ts
// pattern: without this pin the table could quietly stop consuming
// DELIVERY_ROWS and every test would stay green while the shipped table
// lost the latency row.

describe("ProgressDeliveryTable draws the tested rows", () => {
  it("renders from DELIVERY_ROWS, the module the row tests pin", () => {
    expect(source).toContain('from "@/components/progress-delivery"');
    expect(source).toContain("DELIVERY_ROWS.map(");
  });

  it("renders a null cell as the empty-rule dash, never a zero", () => {
    // A null cell is missing data. The empty-rule span is the one honest
    // rendering; printing nothing would read as a layout bug and printing
    // 0 would claim a measurement that never happened.
    expect(source).toContain("cell === null ? dash() : cell");
    expect(source).toContain("EMPTY_RULE");
  });
});
