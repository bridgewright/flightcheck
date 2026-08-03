import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ENTRY_EASE,
  ENTRY_HIDDEN,
  ENTRY_SECONDS,
  ENTRY_SHOWN,
  ENTRY_STAGGER_SECONDS,
  ENTRY_VIEWPORT,
  REVEAL_ATTRIBUTE,
} from "@/components/motion/entry";

// F-21 added the product's first motion layer, and a motion layer nobody
// checks is a motion layer that silently starts shipping tokens to the browser.
//
// The specific history this guards. Commit 79838fd fixed a leak where a
// signed-in screen handed a package access token to a client component, which
// serialized a permanent, package-wide capability into the page's RSC payload.
// components/motion is a directory of client components by definition, so it is
// the easiest place in the tree to reintroduce that leak by accident: someone
// wants an animation to know something about the viewer, adds a prop, and the
// credential is in the HTML. tests/room-token-hygiene.test.ts and
// tests/token-in-href.test.ts guard the screens; nothing guarded this.
//
// The other two claims checked here are the ones the spec's motion budget makes
// about itself: reduced motion is honoured by every leaf, and the only animated
// properties are transform and opacity.
//
// spec: plans/2026-08-03-f21-design-spec.md 6 (private workspace)

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const motionDir = join(webRoot, "components/motion");

/** The client leaves. Non-tsx files in the directory are shared values. */
const leaves = readdirSync(motionDir)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => [name, readFileSync(join(motionDir, name), "utf8")] as const);

/** Everything a leaf is allowed to be handed. */
const PRESENTATIONAL_TYPES = ["React.ReactNode", "string", "number", "boolean"];

/**
 * Names that mean a leaf has been handed something it must never see. `token`
 * covers `access_token` and `startToken` alike; `pkg` covers the abbreviation
 * the worker client uses.
 */
const FORBIDDEN_IDENTIFIERS = [
  "token",
  "viewer",
  "Viewer",
  "session",
  "Session",
  "package",
  "Package",
  "pkg",
  "capability",
];

/** Properties whose animation forces layout. The budget allows neither. */
const LAYOUT_PROPERTIES = ["top", "left", "right", "bottom", "width", "height"];

describe("the motion leaves are client islands", () => {
  it("has leaves to check", () => {
    expect(leaves.length).toBeGreaterThan(0);
  });

  it.each(leaves)("%s declares the client boundary before anything else", (_name, source) => {
    expect(source.trimStart().startsWith('"use client";')).toBe(true);
  });

  it.each(leaves)("%s imports nothing from the server half of the app", (_name, source) => {
    const imported = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
    expect(imported.length).toBeGreaterThan(0);
    for (const specifier of imported) {
      // react, motion, and this directory's own shared values. A leaf that can
      // import lib/worker or lib/viewer is a leaf that can read a credential
      // without anyone passing it one.
      expect(specifier, `${specifier} is not allowed in a motion leaf`).toMatch(
        /^(react|motion\/react|\.\/[a-zA-Z]+)$/,
      );
    }
  });
});

describe("the motion leaves take only presentational props", () => {
  it.each(leaves)("%s declares a props type this test can read", (_name, source) => {
    expect(source).toMatch(/\}: \{[^}]*\}\)/);
  });

  it.each(leaves)("%s accepts no prop that is not a string, number, boolean, or node", (
    name,
    source,
  ) => {
    const block = source.match(/\}: \{([^}]*)\}\)/);
    expect(block, `${name} has no readable props type`).not.toBeNull();
    const declared = [...(block?.[1] ?? "").matchAll(/(\w+)\??:\s*([^;]+);/g)];
    expect(declared.length).toBeGreaterThan(0);
    for (const [, prop, type] of declared) {
      expect(PRESENTATIONAL_TYPES, `${name} takes ${prop}: ${type.trim()}`).toContain(
        type.trim(),
      );
    }
  });

  it.each(leaves)("%s never names a viewer, a session, a package, or a token", (
    _name,
    source,
  ) => {
    // Comments in this directory discuss the leak they exist to prevent, so the
    // scan reads the code only.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const identifier of FORBIDDEN_IDENTIFIERS) {
      expect(code, `${identifier} reached a motion leaf`).not.toContain(identifier);
    }
  });
});

describe("the motion leaves degrade to static", () => {
  it.each(leaves)("%s asks the reader's operating system first", (_name, source) => {
    expect(source).toContain("const reduce = useReducedMotion();");
  });

  it.each(leaves)("%s returns a plain element when motion is refused", (name, source) => {
    // Not a shorter animation: no animation, and no motion component in that
    // branch at all.
    const branch = source.match(/if \(reduce\) \{\s*return ([\s\S]*?);\s*\}/);
    expect(branch, `${name} has no reduced-motion branch`).not.toBeNull();
    expect(branch?.[1]).not.toContain("motion.");
  });
});

describe("the motion leaves animate transform and opacity only", () => {
  it.each(leaves)("%s names no layout property in an animation", (_name, source) => {
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const property of LAYOUT_PROPERTIES) {
      expect(code, `${property} is animated`).not.toMatch(
        new RegExp(`\\b${property}\\s*:`),
      );
    }
  });

  it("moves on the two properties a compositor can handle alone", () => {
    expect(Object.keys(ENTRY_HIDDEN).sort()).toEqual(["opacity", "y"]);
    expect(Object.keys(ENTRY_SHOWN).sort()).toEqual(["opacity", "y"]);
  });
});

describe("the entry budget holds the numbers the spec set", () => {
  it("enters from transparent and 12px low, and settles at rest", () => {
    // Twelve rather than sixteen: at a 14px root the whole page is
    // smaller, and travel that was proportionate before reads as a lurch.
    expect(ENTRY_HIDDEN).toEqual({ opacity: 0, y: 12 });
    expect(ENTRY_SHOWN).toEqual({ opacity: 1, y: 0 });
  });

  it("decelerates rather than overshooting", () => {
    // Bounce is 0 everywhere in this product: there is no gesture carrying
    // momentum, so nothing has a reason to pass its target and come back.
    // 0.3s and cubic-bezier(0.25, 1, 0.5, 1) are the reference's own
    // transform numbers, read off its computed styles. A longer entry
    // reads as the page performing rather than settling.
    expect(ENTRY_SECONDS).toBe(0.3);
    expect(ENTRY_EASE).toEqual([0.25, 1, 0.5, 1]);
    // The curve still decelerates: it ends flat and never exceeds 1.
    expect(ENTRY_EASE[3]).toBe(1);
  });

  it("staggers siblings closely enough to read as one movement", () => {
    expect(ENTRY_STAGGER_SECONDS).toBe(0.05);
  });

  it("plays once, on first sight, and then leaves the page alone", () => {
    expect(ENTRY_VIEWPORT).toEqual({ once: true, amount: 0.25 });
  });

  it("marks every animated element for the no-script backstop", () => {
    // motion writes `initial` into the server HTML, so without a stylesheet
    // rule keyed off this attribute a reader with JavaScript disabled gets a
    // landing page whose text is all present and all invisible. The CSS half of
    // the fix lives in globals.css; this half must not quietly fall off.
    expect(REVEAL_ATTRIBUTE).toEqual({ "data-reveal": "" });
    for (const [name, source] of leaves) {
      expect(source, `${name} ships an unmarked animated element`).toContain(
        "{...REVEAL_ATTRIBUTE}",
      );
    }
  });
});

describe("the call sites pass the leaves nothing but presentation", () => {
  // RevealGroup is not here because it no longer exists. It was a complete
// client component with zero call sites: its own comment said "the arithmetic
// lives here instead of at four call sites" and there were none. Deleted on
// the same ground as CARD_RAISED and ScreenFrame, and because DECISIONS 031
// justifies the motion dependency across the components that actually ship.
const LEAF_NAMES = ["Reveal", "MountReveal"];
  const ALLOWED_PROPS = ["className", "delay", "key"];

  const callSites = [
    "app/page.tsx",
    ...readdirSync(join(webRoot, "components/landing"))
      .filter((name) => name.endsWith(".tsx"))
      .map((name) => `components/landing/${name}`),
  ];

  it.each(callSites)("%s hands the leaves only className and delay", (file) => {
    const source = readFileSync(join(webRoot, file), "utf8");
    for (const leaf of LEAF_NAMES) {
      // Every opening tag for this leaf, up to the closing angle bracket of the
      // tag itself.
      for (const tag of source.matchAll(new RegExp(`<${leaf}\\b([^>]*)>`, "g"))) {
        for (const [, prop] of tag[1].matchAll(/(\w+)=/g)) {
          expect(ALLOWED_PROPS, `${file} passes ${prop} to ${leaf}`).toContain(prop);
        }
      }
    }
  });
});
