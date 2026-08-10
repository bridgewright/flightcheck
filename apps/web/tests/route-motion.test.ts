import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ENTRY_SECONDS, FADE_EASE } from "@/components/motion/entry";
import { ROUTE_CANVAS } from "@/components/motion/route";

// F-88: route changes read as one continuous surface. The mechanism is a CSS
// enter animation on the page's <main>, scoped under the canvas class that
// app/template.tsx applies — CSS so the enter plays before hydration, with
// JavaScript off, and replays whenever a navigation recreates the content
// column. This suite is node-env vitest with no DOM, so what a renderer would
// assert is pinned as source, and the pins count identifier mentions (the
// b5-t3 lesson: a naive grep pin is defeated by one alias).
//
// Motion budget: DECISIONS 031 and 035; this pass: DECISIONS 063.

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(webRoot, path), "utf8");

/** Source with comments blanked, line count preserved — the house idiom, so a
 * comment explaining a banned mechanism is not what fails the scan for it. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, before: string) =>
      before + match.slice(before.length).replace(/./g, " "),
    );
}

const template = read("app/template.tsx");
const emitted = withoutComments(template);
const globals = read("app/globals.css");

describe("the template applies the canvas through the tested decision", () => {
  it("computes its class from routeCanvasClass and from nothing else", () => {
    // Count every mention: the import specifier and the one call. An alias
    // (`const cls = routeCanvasClass;`), a re-export, or a second call site
    // all change this number.
    const mentions = emitted.match(/\brouteCanvasClass\b/g) ?? [];
    expect(mentions.length, "routeCanvasClass is aliased or called again").toBe(2);
    expect(emitted).toContain("className={routeCanvasClass(pathname)}");
  });

  it("never names the canvas class or the room path itself", () => {
    // The exclusion lives in components/motion/route.ts, where it is tested.
    // A literal here would be a second, untested copy of the decision.
    expect(emitted).not.toContain(ROUTE_CANVAS);
    expect(emitted).not.toMatch(/room/);
  });

  it("is one element carrying one class, built from no literal the imports do not name", () => {
    // The evasion this closes, demonstrated live in review: a second wrapper
    // whose className is the canvas name in concatenated fragments
    // (`"route-" + "canvas"`) grants the room the enter while every mention
    // count above stays true and the literal scan above stays blind. So the
    // shape is pinned whole. One element, one className; every double-quoted
    // string in the emitted code must be on the roster of the four the file
    // needs, so a new fragment, however it is split, is a new literal and
    // fails; other quote styles and digits are banned outright, which also
    // closes the template-literal and fromCharCode routes the repo has seen.
    expect(emitted.match(/<[a-zA-Z]/g) ?? []).toHaveLength(1);
    expect(emitted.match(/className=/g) ?? []).toHaveLength(1);
    const literals = [...emitted.matchAll(/"([^"]*)"/g)].map((m) => m[1]).sort();
    expect(literals).toEqual(
      ["@/components/motion/route", "contents", "next/navigation", "use client"].sort(),
    );
    expect(emitted).not.toMatch(/[`']/);
    expect(emitted).not.toMatch(/\d/);
  });

  it("reads the pathname once, from the router", () => {
    const mentions = emitted.match(/\busePathname\b/g) ?? [];
    expect(mentions.length, "usePathname is aliased or called again").toBe(2);
  });

  it("wraps in a box-less scope so the body's flex column is untouched", () => {
    // display: contents generates no box: the template adds a class scope
    // without becoming a layout ancestor, so Shell's flex-1 main and footer
    // keep working against body.
    expect(emitted).toContain('display: "contents"');
  });

  it("stays a scope, not a choreographer", () => {
    // The template must never grow its own animation: the enter lives in the
    // stylesheet where it works before hydration. No motion-library import,
    // no transition prop, no inline animation. (The vocabulary import path
    // components/motion/route is allowed; the library specifier is not.)
    expect(emitted).not.toContain('"motion/react"');
    expect(emitted).not.toMatch(/\banimation\b|\banimate\b|\btransition\b/i);
  });
});

describe("the stylesheet's route enter speaks the entry vocabulary exactly", () => {
  // The one rule, located by the canvas class the module names. Its numbers
  // are compared against components/motion/entry.ts rather than restated, so
  // the stylesheet cannot drift from the budget without this failing.
  const rule = globals.match(
    new RegExp(`\\.${ROUTE_CANVAS} main \\{([^}]*)\\}`),
  );

  it("scopes the enter to the content column under the canvas class", () => {
    expect(rule, `globals.css has no .${ROUTE_CANVAS} main rule`).not.toBeNull();
    // Exactly one selector mentions the canvas class: a second consumer would
    // be a second surface animating outside the template's decision.
    const mentions = globals.match(new RegExp(`\\.${ROUTE_CANVAS}\\b`, "g")) ?? [];
    expect(mentions.length, "the canvas class is consumed twice").toBe(1);
  });

  it("runs for ENTRY_SECONDS on FADE_EASE, by value", () => {
    const declaration = rule?.[1] ?? "";
    const animation = declaration.match(
      /animation:\s*fc-route-enter\s+([\d.]+)s\s+cubic-bezier\(([^)]+)\)/,
    );
    expect(animation, "the rule does not animate fc-route-enter").not.toBeNull();
    expect(Number(animation?.[1])).toBe(ENTRY_SECONDS);
    const curve = (animation?.[2] ?? "").split(",").map((part) => Number(part.trim()));
    expect(curve).toEqual(FADE_EASE);
  });

  it("leaves the fill mode alone, so the finished animation holds no stacking context", () => {
    // A filling opacity animation keeps a stacking context on <main> forever,
    // and a fixed overlay inside main (the home tour's panes) would then
    // paint below the footer. With no fill, the natural opacity: 1 returns
    // the moment the enter finishes and the context dissolves.
    const declaration = rule?.[1] ?? "";
    expect(declaration).not.toMatch(/both|forwards|backwards|fill/);
  });

  it("declares the enter's keyframes exactly once", () => {
    // The evasion this closes, demonstrated live in review: a second
    // `@keyframes fc-route-enter` later in the file wins the cascade
    // wholesale, so it can reintroduce travel while the opacity-only scan
    // below keeps reading the first, innocent declaration. The name is
    // matched to its boundary: a differently named block is inert unless the
    // rule points at it, and the animation pin above holds the rule's target.
    expect(globals.match(/@keyframes fc-route-enter\b/g) ?? []).toHaveLength(1);
  });

  it("dissolves on opacity alone: no travel, no layout property", () => {
    // The screens' own content already carries the reading-order rise where
    // F-58 granted it; travel at the route level would compound to a lurch.
    // One keyframe pair, opacity only.
    const keyframes = globals.match(/@keyframes fc-route-enter \{([\s\S]*?)\n\}/);
    expect(keyframes, "globals.css has no fc-route-enter keyframes").not.toBeNull();
    const body = keyframes?.[1] ?? "";
    expect(body).toMatch(/from\s*\{\s*opacity:\s*0;\s*\}/);
    expect(body).toMatch(/to\s*\{\s*opacity:\s*1;\s*\}/);
    expect(body).not.toMatch(/transform|translate|top|left|width|height|margin/);
  });

  it("is an animation, which the reduced-motion backstop clamps to the settled state", () => {
    // The backstop's `animation-duration: 0.01ms !important` is what turns
    // this enter into the settled state for a reader who asked for stillness
    // — not a shorter fade, the settled state, one frame in. Both halves are
    // pinned: the rule uses `animation`, and the backstop still exists.
    expect(globals).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*animation-duration: 0\.01ms !important/,
    );
  });
});
