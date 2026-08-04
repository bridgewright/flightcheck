import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("../components/LightDismiss.tsx", import.meta.url)),
  "utf-8",
);

// The wiring the F-57 menus depend on (the decision itself is tested in
// components/light-dismiss.test.ts). There is no DOM harness in this suite,
// so what a renderer would assert is pinned as source instead.

describe("LightDismiss listens the way a menu must", () => {
  it("watches pointerdown, not click", () => {
    // A click listener fires after the summary's own native toggle, so a
    // click on the other menu's trigger would close this menu and reopen it
    // in the same gesture. pointerdown runs first and leaves the click free
    // to do its native work.
    expect(source).toContain('document.addEventListener("pointerdown"');
    expect(source).not.toContain('document.addEventListener("click"');
  });

  it("routes both listeners through the shared decision", () => {
    expect(source).toContain('from "@/components/light-dismiss"');
    expect(source).toContain('document.addEventListener("keydown"');
    const calls = source.match(/dismissDecision\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it("returns focus to the summary when the decision says so", () => {
    expect(source).toContain("summaryRef.current?.focus()");
  });

  it("attaches listeners only while open and removes them on cleanup", () => {
    expect(source).toContain("if (!open) return;");
    expect(source).toContain('document.removeEventListener("pointerdown"');
    expect(source).toContain('document.removeEventListener("keydown"');
  });
});

describe("LightDismiss keeps the native details behaviour", () => {
  it("renders a details/summary pair and never cancels the native toggle", () => {
    // With JavaScript disabled this must degrade to today's click-to-toggle
    // menu, so the summary's default activation stays untouched.
    expect(source).toContain("<details");
    expect(source).toContain("<summary");
    expect(source).not.toContain("preventDefault");
  });

  it("tracks open state from the element's own toggle event", () => {
    // Native toggles (mouse, keyboard, no-JS then hydration) all land here,
    // so React state follows the DOM instead of fighting it.
    expect(source).toContain("onToggle");
    expect(source).toContain("currentTarget.open");
  });

  it("carries the data hook and the trigger's aria contract", () => {
    expect(source).toContain("data-light-dismiss");
    expect(source).toContain("aria-expanded={open}");
    expect(source).toContain("aria-label={summaryLabel}");
  });
});
