// Pure helpers for recovering from a denied microphone permission (F-63).
// The browser's native dialog exists only while the permission is "prompt":
// once it is "denied", getUserMedia rejects instantly and no dialog will
// ever appear again, so the only way forward is the browser's own site
// settings. This module supplies the two things that path needs: a
// permission query that never throws (so the UI can subscribe to the
// moment the customer flips the toggle), and per-browser unblocking steps.
// All inputs are structural (no DOM globals), the same discipline as
// lib/session-media.ts.

// --- Permission state -----------------------------------------------------

export type MicPermissionState = "prompt" | "granted" | "denied" | "unknown";

/**
 * The slice of a PermissionStatus this module touches: a readable state and
 * a settable onchange. Both are `unknown` on purpose — lib.dom types the
 * real properties with `this: PermissionStatus` and `ev: Event`, which are
 * not structurally assignable to anything narrower this module could name
 * without importing DOM types it has promised not to depend on. Callers
 * read the state through normalizeMicPermissionState and assign a plain
 * `() => void` (or null) to onchange.
 */
export interface MicPermissionStatusLike {
  state: unknown;
  onchange: unknown;
}

/** The slice of navigator.permissions the query needs. Method syntax, so
 * the real Permissions interface is assignable despite its stricter
 * descriptor type. */
export interface PermissionsLike {
  query(descriptor: { name: string }): Promise<MicPermissionStatusLike>;
}

export interface MicPermissionQuery {
  state: MicPermissionState;
  /** The live PermissionStatus when the query produced one, so callers can
   * subscribe to onchange; null when the API is absent or the query threw. */
  status: MicPermissionStatusLike | null;
}

/** Collapse whatever a PermissionStatus reports to the states this product
 * acts on. Anything unrecognized is "unknown", never a guess. */
export function normalizeMicPermissionState(state: unknown): MicPermissionState {
  if (state === "prompt" || state === "granted" || state === "denied") {
    return state;
  }
  return "unknown";
}

/**
 * Query the microphone permission without ever throwing. "unknown" covers
 * the API being absent (older Safari has no navigator.permissions), the
 * query rejecting (Safari has historically thrown TypeError for the
 * "microphone" name), and a state this module does not recognize. The
 * status object rides along whenever one exists — an unrecognized state
 * still fires onchange, and the subscription is the whole point.
 */
export async function queryMicPermission(
  permissions: PermissionsLike | null | undefined,
): Promise<MicPermissionQuery> {
  if (!permissions || typeof permissions.query !== "function") {
    return { state: "unknown", status: null };
  }
  try {
    const status = await permissions.query({ name: "microphone" });
    if (!status) {
      return { state: "unknown", status: null };
    }
    return { state: normalizeMicPermissionState(status.state), status };
  } catch {
    return { state: "unknown", status: null };
  }
}

// --- Recovery steps -------------------------------------------------------

export type RecoveryBrowser =
  | "chrome"
  | "edge"
  | "safari"
  | "firefox"
  | "unknown";

export interface MicRecoveryGuide {
  browser: RecoveryBrowser;
  steps: readonly string[];
  /** The fine-print line for macOS, where the operating system itself can
   * deny the microphone to the whole browser; null off a Mac. */
  macosNote: string | null;
}

// One action per step, in the product register: calm, concrete, and short
// enough to follow with the settings panel already open. Single literals —
// the built-copy gate's lesson is that joined copy can be folded apart by
// the production bundler.
const CHROME_STEPS: readonly string[] = [
  "Click the icon to the left of the address bar.",
  "Open Site settings.",
  "Set Microphone to Allow.",
  "Reload this page.",
];

const EDGE_STEPS: readonly string[] = [
  "Click the lock icon to the left of the address bar.",
  "Open Permissions for this site.",
  "Set Microphone to Allow.",
  "Reload this page.",
];

const SAFARI_STEPS: readonly string[] = [
  "Open the Safari menu.",
  "Choose Settings for This Website.",
  "Set Microphone to Allow.",
];

const FIREFOX_STEPS: readonly string[] = [
  "Click the permissions icon in the address bar.",
  "Clear the blocked microphone setting.",
  "Reload this page.",
];

// Today's prose ("allow it for this site in your browser settings") split
// into steps, for a browser the sniff does not recognize.
const UNKNOWN_STEPS: readonly string[] = [
  "Open your browser settings for this site.",
  "Allow microphone access.",
  "Reload this page.",
];

const STEPS: Record<RecoveryBrowser, readonly string[]> = {
  chrome: CHROME_STEPS,
  edge: EDGE_STEPS,
  safari: SAFARI_STEPS,
  firefox: FIREFOX_STEPS,
  unknown: UNKNOWN_STEPS,
};

export const MACOS_MICROPHONE_NOTE =
  "macOS can also deny the microphone to the whole browser. If the steps above change nothing, open System Settings, then Privacy and Security, then Microphone, and allow your browser there.";

/**
 * Which browser's menus to describe. Order matters: Edge carries "Chrome/"
 * in its UA, so Edg/ (and its mobile spellings) must be checked first;
 * every other Chromium spelling then lands on chrome, whose menus it
 * shares. Firefox before Safari, because Firefox on iOS carries "Safari/".
 */
function classifyBrowser(userAgent: string): RecoveryBrowser {
  if (/\bEdg(?:A|iOS)?\//.test(userAgent)) return "edge";
  if (/\b(?:Chrome|Chromium|CriOS)\//.test(userAgent)) return "chrome";
  if (/\b(?:Firefox|FxiOS)\//.test(userAgent)) return "firefox";
  if (/\bSafari\//.test(userAgent)) return "safari";
  return "unknown";
}

/**
 * The unblocking guide for this user agent. The macOS note keys on
 * "Macintosh", not "Mac OS X": every iOS UA says "like Mac OS X", and
 * System Settings advice on an iPhone would be wrong.
 */
export function recoverySteps(userAgent: string): MicRecoveryGuide {
  const browser = classifyBrowser(userAgent);
  return {
    browser,
    steps: STEPS[browser],
    macosNote: userAgent.includes("Macintosh") ? MACOS_MICROPHONE_NOTE : null,
  };
}
