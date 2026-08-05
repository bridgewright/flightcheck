import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// F-63, the component half: the denied microphone state stops being a dead
// end. MicCheck and SessionRoom are client components with no render
// harness (environment: node), so this is a source-scan contract in the
// house style, like rubric-receipts.test.ts.
//
// What it holds: MicCheck renders MicRecovery in the denied branch and
// re-runs the check from the permission's onchange handler; SessionRoom
// renders MicRecovery only for the denied mic kind and its handler clears
// the error WITHOUT starting the interview; both subscribe through
// queryMicPermission (no raw permissions.query outside the lib module) and
// clean the subscription up; MicRecovery stays presentational, dash-free,
// and inside the token vocabulary; and the copy that existed before F-63
// stays byte-identical.

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(join(webRoot, rel), "utf8");

/**
 * Source with comments blanked out, line count preserved. The scans below
 * are about what a component emits, not what it explains: a comment naming
 * a start() call must not be what fails the no-start pin.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, before: string) =>
      before + match.slice(before.length).replace(/./g, " "),
    );
}

const micCheckSource = read("components/MicCheck.tsx");
const micCheck = withoutComments(micCheckSource);
const sessionRoomSource = read("components/SessionRoom.tsx");
const sessionRoom = withoutComments(sessionRoomSource);
const micRecoverySource = read("components/MicRecovery.tsx");
const micRecovery = withoutComments(micRecoverySource);

/**
 * Every `.onchange = () => {` handler body in a source, taken by brace
 * balance so the pins below read the whole handler and nothing else.
 */
function onchangeHandlers(source: string): string[] {
  const handlers: string[] = [];
  for (const match of source.matchAll(/\.onchange = \(\) => \{/g)) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          handlers.push(source.slice(open, i + 1));
          break;
        }
      }
    }
  }
  return handlers;
}

describe("MicCheck: the denied state renders the way out and watches for it", () => {
  it("renders MicRecovery in the denied branch with the scope and the settings door", () => {
    expect(micCheck).toMatch(
      /\{state\.kind === "denied" && \(\s*<MicRecovery\s+guide=\{recoverySteps\(navigator\.userAgent\)\}\s+scope=\{state\.scope\}\s+settings=\{systemSettingsLink\(navigator\.userAgent\)\}\s*\/>/,
    );
  });

  it("arms the permission watch only while denied", () => {
    expect(micCheck).toContain('if (state.kind !== "denied") return;');
  });

  it("re-runs the check from the onchange handler when the state leaves denied", () => {
    // The customer's toggle in site settings IS the intent: the handler
    // calls start() so the level bar appears unasked.
    const handlers = onchangeHandlers(micCheck);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]).toMatch(/\bstart\(/);
    expect(handlers[0]).toContain('normalizeMicPermissionState');
    expect(handlers[0]).toContain('"denied"');
  });

  it("draws the denied status line from the scope, not from a fixed sentence", () => {
    expect(micCheck).toContain("DENIED_STATUS_LINES[state.scope]");
  });

  it("captures the scope at failure time, from the permission state", () => {
    expect(micCheck).toContain(
      'setState({ kind: "denied", scope: classifyDeniedScope(permissionState) });',
    );
  });
});

describe("SessionRoom: the mic-error branch learns which failure it holds", () => {
  it("carries the MicFailureKind alongside the message, and the scope for denied", () => {
    expect(sessionRoom).toContain(
      'setError({ kind: "mic", micKind: kind, message: MIC_FAILURE_LINES[kind] });',
    );
    expect(sessionRoom).toContain("micScope: scope,");
    expect(sessionRoom).toContain("message: DENIED_STATUS_LINES[scope],");
  });

  it("renders MicRecovery once, and only for the denied kind", () => {
    expect(sessionRoom.match(/<MicRecovery/g)).toHaveLength(1);
    expect(sessionRoom).toMatch(
      /error\.kind === "mic" && error\.micKind === "denied" && \(\s*<div className="mt-3">\s*<MicRecovery\s+guide=\{recoverySteps\(navigator\.userAgent\)\}\s+scope=\{error\.micScope \?\? "unknown"\}\s+settings=\{systemSettingsLink\(navigator\.userAgent\)\}/,
    );
  });

  it("arms the permission watch only for the denied mic error", () => {
    expect(sessionRoom).toContain(
      'if (error?.kind !== "mic" || error.micKind !== "denied") return;',
    );
  });

  it("clears the error from the onchange handler WITHOUT starting the interview", () => {
    // Starting a session spends a non-repeatable slot, so it stays the
    // customer's click: the handler clears state and does nothing else.
    const handlers = onchangeHandlers(sessionRoom);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]).toContain("setError(null)");
    expect(handlers[0]).not.toMatch(/\bstart\(/);
    expect(handlers[0]).not.toContain("void start");
  });

  it("keeps the Try again button in the error notice", () => {
    expect(sessionRoom).toContain("Try again");
  });
});

describe("both components subscribe through the lib module and clean up", () => {
  it.each([
    ["components/MicCheck.tsx", micCheck],
    ["components/SessionRoom.tsx", sessionRoom],
  ])("%s queries through queryMicPermission", (_file, code) => {
    expect(code).toContain("queryMicPermission(navigator.permissions)");
  });

  it.each([
    ["components/MicCheck.tsx", micCheck],
    ["components/SessionRoom.tsx", sessionRoom],
  ])("%s releases the subscription in the effect cleanup", (_file, code) => {
    expect(code).toContain("cancelled = true;");
    expect(code).toContain("onchange = null;");
  });

  it("keeps raw permissions.query out of every screen: lib/mic-permission.ts owns it", () => {
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const entry of readdirSync(join(webRoot, dir))) {
        const rel = `${dir}/${entry}`;
        if (statSync(join(webRoot, rel)).isDirectory()) out.push(...walk(rel));
        else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(rel);
      }
      return out;
    };
    const files = [...walk("app"), ...walk("components"), ...walk("lib")];
    const offenders = files.filter((file) =>
      /permissions\??\.query\s*\(/.test(withoutComments(read(file))),
    );
    expect(offenders).toEqual(["lib/mic-permission.ts"]);
  });
});

describe("MicRecovery stays presentational and inside the vocabulary", () => {
  it("renders the guide as a LABEL heading over an ordered list", () => {
    expect(micRecovery).toMatch(
      /import \{[^}]*\bFINE_PRINT\b[^}]*\} from "@\/lib\/ui"|import \{[^}]*\bLABEL\b[^}]*\} from "@\/lib\/ui"/,
    );
    expect(micRecovery).toContain("className={LABEL}");
    expect(micRecovery).toContain("<ol");
    expect(micRecovery).toContain("guide.steps.map");
  });

  it("renders the macOS fine print only when the scope is unknown", () => {
    // When the browser told us the block is site-level, OS advice is noise;
    // the note survives only where the permissions API left us guessing.
    expect(micRecovery).toMatch(
      /\{scope === "unknown" && guide\.macosNote !== null && \(?\s*<p className=\{FINE_PRINT\}>\{guide\.macosNote\}<\/p>\s*\)?\}/,
    );
  });

  it("opens the OS microphone pane as a real door in the system scope", () => {
    expect(micRecovery).toMatch(/<a href=\{settings\.href\}/);
    expect(micRecovery).toContain("SYSTEM_SETTINGS_RETURN_LINE");
    expect(micRecovery).toContain("SYSTEM_SETTINGS_FALLBACK_LINE");
  });

  it("needs no recovery UI at all for a dismissed dialog", () => {
    expect(micRecovery).toMatch(
      /if \(scope === "ask-again"\) \{\s*return <p className=\{FINE_PRINT\}>\{ASK_AGAIN_LINE\}<\/p>;/,
    );
  });

  it("holds no state and no effects: props in, markup out", () => {
    expect(micRecovery).not.toMatch(/\buse(?:State|Effect|Ref|Callback|Memo)\b/);
  });

  it("carries no dash characters at all", () => {
    expect(micRecoverySource).not.toMatch(/[–—]/);
  });

  it("paints no raw colour of its own", () => {
    expect(micRecovery).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(micRecovery).not.toMatch(/\b(?:rgb|hsl|oklch|oklab)a?\(/);
    expect(micRecovery).not.toMatch(
      /\b(?:text|bg|border|decoration|ring|outline)-(?:neutral|gray|grey|slate|zinc|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)\b/,
    );
  });
});
