import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const page = readFileSync(
  join(root, "app/quick/report/[packageId]/page.tsx"),
  "utf8",
);

describe("quick report", () => {
  it("requires ownership and quick kind", () => {
    // The list is the viewer's own, so a foreign id, a standard package, and
    // an id that never existed all take the same exit.
    expect(page).toContain("listPackagesForUser(viewer.id)");
    expect(page).toContain("packages.find((item) => item.id === packageId)");
    expect(page).toContain('pkg === undefined || pkg.kind !== "quick"');
    expect(page).toContain("notFound()");
  });

  it("sends a signed-out visitor through login and back", () => {
    expect(page).toContain(
      "redirect(`/login?next=${encodeURIComponent(`/quick/report/${packageId}`)}`)",
    );
  });

  it("survives a worker restart the way every other package screen does", () => {
    expect(page).toContain("try {");
    expect(page).toContain("catch {");
    expect(page).toContain("<PollRefresh");
  });

  it("puts the sample warning before the shared report renderer", () => {
    expect(page.indexOf("This is a sample report")).toBeLessThan(
      page.indexOf("<ReportView"),
    );
    expect(page).toContain("The quick interview is not scored.");
    // The fixture and the renderer are the ones /sample-report uses. A forked
    // copy would let the pitch drift into showing numbers no customer gets.
    expect(page).toContain("loadSampleReport(sampleJson)");
    expect(page).toContain(
      "<ReportView report={sample.report} dimensions={sample.dimensions} />",
    );
  });

  it("puts the visitor's own words in the heading and nowhere else", () => {
    expect(page).toContain("report at {company} looks like");
    expect(page).not.toContain("dangerouslySetInnerHTML");

    // Every line mentioning company or role, other than where they are
    // derived and where they are rendered as heading text. An attribute, a
    // URL, or a metadata field would be a different kind of thing entirely:
    // JSX text children are escaped, href and content values are not, and
    // metadata is served to crawlers.
    const offenders = page
      .split("\n")
      .map((line, index) => ({ line: line.trim(), number: index + 1 }))
      .filter(({ line }) => /\b(company|role)\b/.test(line))
      .filter(({ line }) => !/^const (company|role) = pkg\.quick_/.test(line))
      .filter(({ line }) => !line.startsWith("<h1"))
      .filter(({ line }) => !line.startsWith("//") && !line.startsWith("*"))
      .map(({ line, number }) => `page.tsx:${number}: ${line}`);
    expect(offenders).toEqual([]);
  });

  it("keeps user text out of the page metadata", () => {
    // metadata is a module constant declared above the component, so it
    // cannot see the package at all — pin both halves of that.
    const metadata = page.slice(
      page.indexOf("export const metadata"),
      page.indexOf("export default"),
    );
    expect(metadata).not.toContain("${");
    expect(metadata).not.toContain("company");
    expect(metadata).not.toContain("role");
    expect(page.indexOf("export const metadata")).toBeLessThan(
      page.indexOf("export default"),
    );
  });

  it("names a fallback for a package the worker stored without either field", () => {
    expect(page).toContain('|| "your target company"');
    expect(page).toContain('|| "your target role"');
  });

  it("pins the CTA targets", () => {
    expect(page).toContain('href="/new"');
    expect(page).toContain('href="/pricing"');
  });

  it("renders a hostile company and role as inert text", () => {
    // The heading is the one place a stranger's own words reach a screen.
    // The source pin above is what keeps them a text child; this is what
    // that buys, rendered, for the strings someone would actually try.
    for (const hostile of [
      '<script>alert("xss")</script>',
      '" onmouseover="alert(1)',
      "</h1><img src=x onerror=alert(1)>",
      "Ben & Jerry's",
    ]) {
      const markup = renderToStaticMarkup(
        createElement(
          "h1",
          null,
          "What a scored ",
          hostile,
          " report at ",
          hostile,
          " looks like",
        ),
      );
      expect(markup.startsWith("<h1>")).toBe(true);
      expect(markup.endsWith("</h1>")).toBe(true);
      // Inside the heading, every angle bracket and quote the visitor typed
      // came back as an entity, so nothing they wrote can open a tag or an
      // attribute. "onerror=alert(1)" surviving as visible words is the
      // point: it is text now.
      const inner = markup.slice("<h1>".length, -"</h1>".length);
      expect(inner).toMatch(/^[^<>"]*$/);
      expect(inner).toContain("What a scored ");
    }
  });
});
