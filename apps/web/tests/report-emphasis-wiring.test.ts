import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// F-48. Three renderers draw the same report (screen, PDF, markdown export),
// and the emphasis rule they apply to a dimension's rationale must be one
// function, not three readings of it. The suite has no DOM harness, so the
// components are pinned the way this repo pins components: by what their
// source imports and calls. lib/rationale-key-span.test.ts proves the rule
// itself; this file proves nobody rewrote it locally.

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(webRoot, path), "utf8");

const RENDERERS = [
  "components/ReportView.tsx",
  "components/ReportPdf.tsx",
  "lib/report-markdown.ts",
] as const;

describe("every renderer takes the emphasis from lib/rationale.ts", () => {
  it.each(RENDERERS)("%s calls emphasiseRationale with the judge's span", (file) => {
    const source = read(file);
    expect(source).toContain("emphasiseRationale");
    // The span reaches the rule from the dimension itself, not from a copy.
    expect(source).toContain("key_span");
  });

  it.each(RENDERERS)("%s holds no local copy of the positional rule", (file) => {
    const source = read(file);
    // splitRationale is the fallback INSIDE emphasiseRationale. A renderer
    // calling it directly is a renderer that can disagree with the other two.
    expect(source).not.toContain("splitRationale");
    // Nor a re-derived sentence boundary.
    expect(source).not.toMatch(/\[\.\!\?\]/);
  });
});

describe("old reports keep their exact rendering", () => {
  it("the PDF renders the fallback rationale as one plain block, as before F-48", () => {
    // Byte-identical markdown is pinned by fixture in
    // lib/report-markdown-key-span.test.ts; the PDF equivalent is this source
    // pin: the first_sentence branch emits the untouched rationale.
    expect(read("components/ReportPdf.tsx")).toContain("<Text>{score.rationale}</Text>");
  });
});

describe("per-dimension strengths and weaknesses, in one voice", () => {
  it.each(RENDERERS)("%s uses the screen's labels and renders nothing when empty", (file) => {
    const source = read(file);
    expect(source).toContain("What worked");
    expect(source).toContain("What held the score down");
    // Conditional on content: an old report must not grow empty headers.
    expect(source).toContain("strengths.length > 0");
    expect(source).toContain("weaknesses.length > 0");
    // And absent fields read as empty: every report stored before F-03
    // omits the keys at runtime whatever the type declares.
    expect(source).toContain("strengths ?? []");
    expect(source).toContain("weaknesses ?? []");
  });
});
