import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("../components/TopBar.tsx", import.meta.url)),
  "utf-8",
);

// The top bar's half of F-57 (menus that dismiss like menus). The behaviour
// itself lives in the shared primitive and is tested there:
// light-dismiss-client.test.ts pins the listener wiring and
// components/light-dismiss.test.ts the decision. What this file pins is that
// TopBar actually consumes the primitive, and consumes it the intended way.
// No DOM harness in this suite, so source is the pin.

describe("both top-bar menus dismiss through LightDismiss (F-57)", () => {
  it("replaces the raw details/summary pairs with the primitive", () => {
    expect(source).toContain('from "@/components/LightDismiss"');
    const uses = source.match(/<LightDismiss/g) ?? [];
    expect(uses.length).toBe(2);
    // No hand-rolled disclosure survives: the primitive renders the
    // details/summary structure itself.
    expect(source).not.toContain("<details");
    expect(source).not.toContain("<summary");
  });

  it("stays a server component; the primitive is the only client boundary", () => {
    expect(source).not.toContain('"use client"');
    // Dismissal is the primitive's job. The moment TopBar grows its own
    // listener or decision call, there are two opinions about closing.
    expect(source).not.toContain("addEventListener");
    expect(source).not.toContain("preventDefault");
    expect(source).not.toContain("dismissDecision");
  });

  it("anchors each panel through panelClassName, not its own wrapper", () => {
    expect(source).toContain("panelClassName={`${MENU_PANEL} left-0`}");
    expect(source).toContain("panelClassName={`${MENU_PANEL} right-0`}");
    // Import plus the two seats. A third use inside children would nest a
    // panel inside the panel LightDismiss already renders.
    const panels = source.match(/MENU_PANEL/g) ?? [];
    expect(panels.length).toBe(3);
  });

  it("keeps the order classes the wrapping mobile bar depends on", () => {
    expect(source).toContain('className="relative order-2"');
    expect(source).toContain('className="relative order-3 ml-auto sm:order-4"');
  });

  it("keeps the account trigger's accessible name", () => {
    expect(source).toContain('summaryLabel="Account menu"');
  });
});
