import { describe, expect, it } from "vitest";

import {
  MACOS_MICROPHONE_NOTE,
  normalizeMicPermissionState,
  queryMicPermission,
  recoverySteps,
  type MicPermissionStatusLike,
  type RecoveryBrowser,
} from "@/lib/mic-permission";

// F-63: once the microphone permission is "denied", getUserMedia rejects
// instantly and the browser will never show its dialog again — the prose
// pointing at "your browser settings" was a dead end at the exact moment a
// paying customer was trying to start a session. These helpers are what
// replaces it: a permission query that never throws, and per-browser
// unblocking steps the recovery UI renders as an ordered list.

// Real user-agent strings, captured rather than invented: classification
// bugs live in the details (Edge carries "Chrome/", iOS Safari carries
// "like Mac OS X", Firefox on iOS carries "Safari/").
const UA = {
  chromeMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  chromeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  edgeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  firefoxWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
  iosSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  opera:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 OPR/112.0.0.0",
} as const;

describe("recoverySteps: user-agent classification", () => {
  it.each([
    ["real Chrome on macOS", UA.chromeMac, "chrome"],
    ["real Chrome on Windows", UA.chromeWindows, "chrome"],
    ["Edge on Windows", UA.edgeWindows, "edge"],
    ["Safari on macOS", UA.safariMac, "safari"],
    ["Firefox on Windows", UA.firefoxWindows, "firefox"],
    ["Safari on iOS", UA.iosSafari, "safari"],
    ["an empty string", "", "unknown"],
  ] as [string, string, RecoveryBrowser][])(
    "classifies %s",
    (_name, userAgent, browser) => {
      expect(recoverySteps(userAgent).browser).toBe(browser);
    },
  );

  it("checks Edg/ before Chrome: the Edge UA carries Chrome/ and must not classify as chrome", () => {
    // The ordering bug this pins: Edge's UA contains "Chrome/126.0.0.0", so
    // a Chrome-first sniff would hand every Edge customer Chrome menus that
    // do not exist in their browser.
    expect(UA.edgeWindows).toContain("Chrome/");
    expect(recoverySteps(UA.edgeWindows).browser).toBe("edge");
  });

  it("treats other Chromium UAs as chrome", () => {
    expect(recoverySteps(UA.opera).browser).toBe("chrome");
  });
});

describe("recoverySteps: the steps themselves", () => {
  const browsers: RecoveryBrowser[] = [
    "chrome",
    "edge",
    "safari",
    "firefox",
    "unknown",
  ];
  const guides = {
    chrome: recoverySteps(UA.chromeWindows),
    edge: recoverySteps(UA.edgeWindows),
    safari: recoverySteps(UA.iosSafari),
    firefox: recoverySteps(UA.firefoxWindows),
    unknown: recoverySteps(""),
  };

  it.each(browsers)("%s gets short one-action steps", (browser) => {
    const { steps } = guides[browser];
    expect(steps.length).toBeGreaterThanOrEqual(3);
    for (const step of steps) {
      expect(step.trim().length).toBeGreaterThan(0);
      expect(step).not.toContain("\n");
    }
  });

  it.each(browsers)("%s keeps the register calm: no exclamation marks, no dashes", (browser) => {
    const { steps, macosNote } = guides[browser];
    for (const line of [...steps, ...(macosNote === null ? [] : [macosNote])]) {
      expect(line).not.toContain("!");
      expect(line).not.toMatch(/[–—-]/);
    }
  });

  it("sends Chrome through the icon left of the address bar to Site settings", () => {
    const joined = guides.chrome.steps.join(" ");
    expect(joined).toContain("address bar");
    expect(joined).toContain("Site settings");
    expect(joined).toContain("Allow");
    expect(joined).toContain("Reload");
  });

  it("gives Edge the same shape in its own wording", () => {
    const joined = guides.edge.steps.join(" ");
    expect(joined).toContain("address bar");
    expect(joined).toContain("Allow");
    expect(joined).toContain("Reload");
    expect(guides.edge.steps).not.toEqual(guides.chrome.steps);
  });

  it("sends Safari through the Safari menu's per-site settings", () => {
    const joined = guides.safari.steps.join(" ");
    expect(joined).toContain("Safari menu");
    expect(joined).toContain("Settings for This Website");
    expect(joined).toContain("Allow");
  });

  it("has Firefox clear the blocked setting from the permissions icon", () => {
    const joined = guides.firefox.steps.join(" ");
    expect(joined).toContain("permissions icon");
    expect(joined).toContain("blocked");
    expect(joined).toContain("Reload");
  });

  it("gives an unrecognized browser the generic version of today's prose, split into steps", () => {
    const joined = guides.unknown.steps.join(" ");
    expect(joined).toContain("browser settings");
    expect(joined.toLowerCase()).toContain("microphone");
    expect(joined).toContain("Reload");
  });
});

describe("recoverySteps: the macOS fine print", () => {
  it.each([
    ["Chrome on macOS", UA.chromeMac],
    ["Safari on macOS", UA.safariMac],
  ])("is present for %s", (_name, userAgent) => {
    expect(recoverySteps(userAgent).macosNote).toBe(MACOS_MICROPHONE_NOTE);
  });

  it.each([
    ["Chrome on Windows", UA.chromeWindows],
    ["Firefox on Windows", UA.firefoxWindows],
    // iOS says "like Mac OS X" in every UA; the platform hint is
    // "Macintosh", and System Settings advice on an iPhone would be wrong.
    ["Safari on iOS", UA.iosSafari],
    ["an empty string", ""],
  ])("is absent for %s", (_name, userAgent) => {
    expect(recoverySteps(userAgent).macosNote).toBeNull();
  });

  it("names the whole path: System Settings, Privacy and Security, Microphone", () => {
    expect(MACOS_MICROPHONE_NOTE).toContain("System Settings");
    expect(MACOS_MICROPHONE_NOTE).toContain("Privacy and Security");
    expect(MACOS_MICROPHONE_NOTE).toContain("Microphone");
  });
});

describe("queryMicPermission", () => {
  it("returns unknown with no status when the Permissions API is absent", async () => {
    await expect(queryMicPermission(undefined)).resolves.toEqual({
      state: "unknown",
      status: null,
    });
    await expect(queryMicPermission(null)).resolves.toEqual({
      state: "unknown",
      status: null,
    });
  });

  it("returns unknown with no status when query rejects, as Safari has for the microphone name", async () => {
    const permissions = {
      query: () => Promise.reject(new TypeError("microphone is not a valid enum value")),
    };
    await expect(queryMicPermission(permissions)).resolves.toEqual({
      state: "unknown",
      status: null,
    });
  });

  it.each(["prompt", "granted", "denied"] as const)(
    "returns %s with the live status object, for the onchange subscription",
    async (state) => {
      const status: MicPermissionStatusLike = { state, onchange: null };
      const permissions = { query: () => Promise.resolve(status) };
      const result = await queryMicPermission(permissions);
      expect(result.state).toBe(state);
      expect(result.status).toBe(status);
    },
  );

  it("returns unknown for an unrecognized state, but still hands back the status", async () => {
    const status: MicPermissionStatusLike = { state: "limited", onchange: null };
    const permissions = { query: () => Promise.resolve(status) };
    const result = await queryMicPermission(permissions);
    expect(result.state).toBe("unknown");
    expect(result.status).toBe(status);
  });
});

describe("normalizeMicPermissionState", () => {
  it.each(["prompt", "granted", "denied"] as const)("passes %s through", (state) => {
    expect(normalizeMicPermissionState(state)).toBe(state);
  });

  it("collapses everything else to unknown", () => {
    expect(normalizeMicPermissionState("limited")).toBe("unknown");
    expect(normalizeMicPermissionState(undefined)).toBe("unknown");
    expect(normalizeMicPermissionState(null)).toBe("unknown");
    expect(normalizeMicPermissionState(42)).toBe("unknown");
  });
});
