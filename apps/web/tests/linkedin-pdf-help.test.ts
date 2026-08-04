import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { TRIGGER_LABEL } from "@/components/linkedin-help/walkthrough-steps";

// The LinkedIn PDF walkthrough's wiring (F-55). The stepping behaviour is
// tested in components/linkedin-help/walkthrough-steps.test.ts and the
// choreography in walkthrough-motion.test.ts; there is no DOM harness in
// this suite, so what a renderer would assert is pinned as source instead,
// the same way tests/light-dismiss-client.test.ts pins the menus.

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(webRoot, path), "utf-8");

const help = read("components/LinkedInPdfHelp.tsx");
const stage = read("components/linkedin-help/WalkthroughStage.tsx");
const page = read("app/new/page.tsx");

/** Every source file this feature is made of. */
const FEATURE_FILES = [
  "components/LinkedInPdfHelp.tsx",
  ...readdirSync(join(webRoot, "components/linkedin-help"))
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    .map((name) => `components/linkedin-help/${name}`),
];

describe("the trigger and the bubble carry the aria contract", () => {
  it("labels the icon-only trigger through LightDismiss", () => {
    // LightDismiss owns the summary element and its aria-expanded; the help
    // popover hands it the label because the visible content is one glyph.
    expect(help).toContain('from "@/components/LightDismiss"');
    expect(help).toContain("summaryLabel={TRIGGER_LABEL}");
    expect(TRIGGER_LABEL).toBe("How to export this PDF from LinkedIn");
  });

  it("is a non-modal dialog with no focus trap", () => {
    expect(help).toContain('role="dialog"');
    expect(help).toContain('aria-labelledby="linkedin-pdf-help-title"');
    expect(help).toContain('aria-describedby="linkedin-pdf-help-caption"');
    // Deliberately non-modal, diverging from the reference libraries: the
    // form is never blocked, so no aria-modal and no trap of any kind.
    expect(help).not.toContain("aria-modal");
    for (const file of FEATURE_FILES) {
      expect(read(file)).not.toMatch(/focus-?trap/i);
    }
  });

  it("hides the stage from screen readers and announces steps politely", () => {
    // The stage is decoration; each caption states the complete instruction,
    // so a reader who never perceives the animation loses nothing.
    expect(stage).toContain('aria-hidden="true"');
    expect(help).toContain('aria-live="polite"');
    expect(help).toContain('aria-atomic="true"');
    // The live region speaks "Step n of 3." while the visible counter stays
    // aria-hidden, so nothing announces twice.
    expect(help).toContain("liveText(");
    expect(help).toContain('className="sr-only"');
    expect(help).toMatch(/aria-hidden="true"[^>]*>\s*\{counterText\(/);
  });

  it("keeps Back present but disabled on step 1, so the footer never reflows", () => {
    expect(help).toContain("aria-disabled={!canBack(state)}");
    expect(help).not.toContain("canBack(state) ? <button");
  });

  it("renders the copy from the model module, never inline", () => {
    expect(help).toContain('from "@/components/linkedin-help/walkthrough-steps"');
    expect(help).toContain("{CAPTIONS[state.step]}");
    expect(help).toContain("{FINE_PRINTS[state.step]}");
    expect(help).not.toContain("On LinkedIn, open");
  });
});

describe("dismissal is light, and only light", () => {
  it("adds no close on tab switch or window switch, ever", () => {
    // The reader will spend a minute in the LinkedIn tab; the popover must
    // be sitting there, on the same step, when they come back. Escape and
    // outside pointerdown live in LightDismiss; nothing else may close it.
    for (const file of FEATURE_FILES) {
      const source = read(file);
      expect(source, `${file} watches tab visibility`).not.toContain("visibilitychange");
      expect(source, `${file} closes on blur`).not.toMatch(/addEventListener\("blur"|onBlur/);
      expect(source, `${file} closes on focusout`).not.toMatch(/focusout|onFocusOut/i);
    }
  });

  it("closes on Done and hands focus to the real file input", () => {
    // The last step's call to action terminates into the real action: the
    // input's own focus ring does the pointing after the bubble is gone.
    expect(help).toContain("details.open = false;");
    expect(help).toContain("document.getElementById(inputId)?.focus()");
  });

  it("returns focus to the trigger from the close glyph", () => {
    // Escape already refocuses through LightDismiss's dismissDecision; the
    // close button does the same by hand.
    expect(help).toContain('aria-label="Close"');
    expect(help).toContain('querySelector("summary")');
  });

  it("restarts at step 1 on every reopen", () => {
    expect(help).toMatch(/if \(details\.open\) setState\(\(current\) => reset\(current\)\);/);
  });
});

describe("reduced motion is no motion", () => {
  it("asks the reader's operating system first", () => {
    expect(help).toContain("const reduce = useReducedMotion()");
  });

  it("drops the Replay control entirely: there is nothing to replay", () => {
    expect(help).toMatch(/\{reduce \? null : \(\s*<div[^>]*>\s*<button[^>]*aria-label="Replay/);
  });

  it("renders the stage's end state instead of playing the sequence", () => {
    expect(stage).toContain("if (reduce) return;");
  });
});

describe("the form is never blocked", () => {
  it("keeps the file input plain, optional, and labeled", () => {
    expect(page).toContain('htmlFor="linkedin-profile-pdf"');
    expect(page).toContain('id="linkedin-profile-pdf"');
    const input = page.match(/<input\s+id="linkedin-profile-pdf"[\s\S]*?\/>/);
    expect(input, "the LinkedIn file input moved or grew markup").not.toBeNull();
    expect(input?.[0]).not.toContain("disabled");
    expect(input?.[0]).toContain('type="file"');
  });

  it("keeps the one line text hint: the popover is the show me layer on top", () => {
    expect(page).toContain("Export it from LinkedIn: open your profile, then");
  });

  it("mounts the helper beside the label, inside the LinkedIn fieldset", () => {
    expect(page).toContain('from "@/components/LinkedInPdfHelp"');
    expect(page).toContain('<LinkedInPdfHelp inputId="linkedin-profile-pdf" />');
  });
});

describe("no LinkedIn pixels, no image assets at all", () => {
  it("ships no image file that smells of LinkedIn anywhere in public/", () => {
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const entry of readdirSync(join(webRoot, dir))) {
        const rel = `${dir}/${entry}`;
        if (statSync(join(webRoot, rel)).isDirectory()) out.push(...walk(rel));
        else out.push(rel);
      }
      return out;
    };
    expect(existsSync(join(webRoot, "public"))).toBe(true);
    expect(walk("public").filter((name) => /linkedin|licdn/i.test(name))).toEqual([]);
  });

  it("draws the walkthrough from tokens and inline SVG, never from files or URLs", () => {
    for (const file of FEATURE_FILES) {
      const source = read(file);
      expect(source, `${file} renders an image element`).not.toMatch(/<img\b|next\/image/);
      expect(source, `${file} references an image file`).not.toMatch(
        /\.(png|jpe?g|gif|webp|avif|ico)\b/i,
      );
      expect(source, `${file} imports an svg asset`).not.toMatch(/\.svg\b/);
      expect(source, `${file} reaches an external URL`).not.toMatch(/https?:\/\//);
      expect(source, `${file} touches LinkedIn's CDN`).not.toMatch(/licdn/i);
      expect(source, `${file} sets a src`).not.toMatch(/\bsrc=/);
    }
  });

  it("names the real labels as text, which is the whole abstraction deal", () => {
    // The load bearing click targets are named in text and nothing else on
    // the mock is: no logos, no trade dress, no blue.
    expect(stage).toMatch(/>\s*More\s*</);
    expect(stage).toMatch(/>\s*Save to PDF\s*</);
  });

  it("keeps every dash and every raised voice out of the feature files", () => {
    // The repo wide gate covers strings and JSX text; these files hold the
    // stricter line the landing files hold, comments included.
    for (const file of FEATURE_FILES) {
      expect(read(file), `${file} carries a dash`).not.toMatch(/[–—]/);
    }
  });
});
