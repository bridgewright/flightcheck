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

// --- Where the block lives ------------------------------------------------

export type DeniedScope = "site" | "system" | "ask-again" | "unknown";

/**
 * Where a permission-denied failure actually lives, read from the evidence
 * at failure time: getUserMedia refused while the SITE permission reports
 * "denied" means the browser is blocking this site (the steps are the way
 * out); "granted" means the browser would allow it and capture still
 * refused, so the operating system is blocking the browser itself (the OS
 * settings door is the way out); "prompt" means the dialog was dismissed
 * and the very next attempt will re-ask on its own. "unknown" keeps the
 * generic guidance.
 */
export function classifyDeniedScope(state: MicPermissionState): DeniedScope {
  if (state === "denied") return "site";
  if (state === "granted") return "system";
  if (state === "prompt") return "ask-again";
  return "unknown";
}

/** The denied status line, per scope. Verb-neutral on purpose: the button
 * under it says "Check again" in the mic check and "Try again" in the
 * room, and the line must not argue with either. */
export const DENIED_STATUS_LINES: Record<DeniedScope, string> = {
  site: "Microphone access is blocked for this site in your browser.",
  system:
    "Microphone access is blocked by your operating system, not by this site.",
  "ask-again": "The permission request was closed before an answer.",
  unknown:
    "Microphone access is blocked. Allow it for this site in your browser settings.",
};

// --- The doors a page can actually open -----------------------------------
// A web page cannot open the browser's own site-settings UI and cannot
// re-show a denied permission dialog; no such API exists, by design. What
// it CAN do: deep-link the operating system's microphone pane through an
// OS URL scheme (the browser shows its open-an-app confirmation first),
// which is exactly the door the "system" scope needs.

export const MACOS_MIC_SETTINGS_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";

export const WINDOWS_MIC_SETTINGS_URL = "ms-settings:privacy-microphone";

export interface SystemSettingsLink {
  href: string;
  label: string;
}

/** The OS microphone pane for this user agent, when one can be opened.
 * "Macintosh" excludes iOS (every iOS UA says "like Mac OS X"). */
export function systemSettingsLink(
  userAgent: string,
): SystemSettingsLink | null {
  if (userAgent.includes("Macintosh")) {
    return {
      href: MACOS_MIC_SETTINGS_URL,
      label: "Open macOS microphone settings",
    };
  }
  if (userAgent.includes("Windows")) {
    return {
      href: WINDOWS_MIC_SETTINGS_URL,
      label: "Open Windows microphone settings",
    };
  }
  return null;
}

export const ASK_AGAIN_LINE =
  "Your browser will ask for the microphone again on the next attempt. Choose Allow when it does.";

export const SYSTEM_SETTINGS_RETURN_LINE =
  "Allow your browser there, then come back and try the microphone again.";

/** The system-scope fallback for an OS without a deep link. */
export const SYSTEM_SETTINGS_FALLBACK_LINE =
  "Open your system settings, find Privacy, then Microphone, and allow your browser.";

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
// Chromium shows a microphone icon with a red mark at the RIGHT end of the
// address bar right after it blocks a request, and clicking it is the
// shortest path out; the tune icon on the left is the fallback when that
// badge has already gone.
const CHROME_STEPS: readonly string[] = [
  "Click the microphone icon with the red mark at the right end of the address bar.",
  "Choose to always allow this site to use your microphone.",
  "If no such icon is there, click the tune icon at the left end of the address bar and set Microphone to Allow.",
];

const EDGE_STEPS: readonly string[] = [
  "Click the microphone icon with the red mark at the right end of the address bar.",
  "Choose to always allow this site to use your microphone.",
  "If no such icon is there, click the lock icon at the left end of the address bar and set Microphone to Allow.",
];

const SAFARI_STEPS: readonly string[] = [
  "Open the Safari menu.",
  "Choose Settings for This Website.",
  "Set Microphone to Allow.",
];

const FIREFOX_STEPS: readonly string[] = [
  "Click the crossed microphone icon in the address bar.",
  "Clear the blocked microphone setting, then allow when asked again.",
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
