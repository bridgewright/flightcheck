import { describe, expect, it } from "vitest";

import {
  AUDIO_START_FAILURE_MESSAGE,
  IN_APP_BROWSER_HINT,
  MIC_FAILURE_LINES,
  RECORDER_MIME_CANDIDATES,
  RECORDER_UNAVAILABLE_MESSAGE,
  RECORDING_DISCLOSURE,
  SUPPORTED_BROWSERS_LINE,
  classifyMicFailure,
  containerType,
  missingCapabilities,
  pickRecorderMimeType,
  unsupportedBrowserMessage,
} from "@/lib/session-media";

// The Safari/iOS fix (F-28) lives or dies on these pure helpers: which
// recording container the room asks MediaRecorder for, which browsers get
// gated out before the mic check, and the exact copy every failure shows.
// The audit's root cause was a construction throw that vanished inside the
// dc-open handler — the container choice must therefore be decidable (and
// testable) BEFORE anything is constructed.

describe("pickRecorderMimeType", () => {
  it("prefers webm/opus where it is supported (Chrome, Edge, Firefox)", () => {
    const chromeLike = (type: string) => type.startsWith("audio/webm");
    expect(pickRecorderMimeType(chromeLike)).toBe("audio/webm;codecs=opus");
  });

  it("falls back to audio/mp4 on Safari, which cannot record webm", () => {
    const safariLike = (type: string) => type === "audio/mp4";
    expect(pickRecorderMimeType(safariLike)).toBe("audio/mp4");
  });

  it("takes plain webm when the opus flavor is refused", () => {
    const plainWebm = (type: string) => type === "audio/webm";
    expect(pickRecorderMimeType(plainWebm)).toBe("audio/webm");
  });

  it("returns null when no candidate is supported — the honest gate state", () => {
    expect(pickRecorderMimeType(() => false)).toBeNull();
  });

  it("defaults to the first candidate when the probe itself is missing", () => {
    // Very old MediaRecorder implementations predate isTypeSupported; the
    // constructor try/catch is the net for those.
    expect(pickRecorderMimeType(undefined)).toBe(RECORDER_MIME_CANDIDATES[0]);
  });
});

describe("containerType", () => {
  it("strips the codecs parameter for the Blob/upload Content-Type", () => {
    expect(containerType("audio/webm;codecs=opus")).toBe("audio/webm");
  });

  it("passes a bare container through unchanged", () => {
    expect(containerType("audio/mp4")).toBe("audio/mp4");
  });
});

describe("classifyMicFailure", () => {
  it("maps permission failures to denied", () => {
    expect(classifyMicFailure("NotAllowedError")).toBe("denied");
    expect(classifyMicFailure("SecurityError")).toBe("denied");
  });

  it("maps hardware absence to no-device", () => {
    expect(classifyMicFailure("NotFoundError")).toBe("no-device");
    expect(classifyMicFailure("OverconstrainedError")).toBe("no-device");
  });

  it("maps anything else — including a non-DOMException — to other", () => {
    expect(classifyMicFailure("NotReadableError")).toBe("other");
    expect(classifyMicFailure("")).toBe("other");
  });

  it("has a discriminated line for every kind", () => {
    expect(MIC_FAILURE_LINES.denied).toContain("blocked");
    expect(MIC_FAILURE_LINES["no-device"]).toContain("No microphone was found");
    expect(MIC_FAILURE_LINES.other).toContain("Reload the page");
  });
});

describe("missingCapabilities", () => {
  const all = {
    hasGetUserMedia: true,
    hasRTCPeerConnection: true,
    hasMediaRecorder: true,
  };

  it("returns nothing for a fully capable browser", () => {
    expect(missingCapabilities(all)).toEqual([]);
  });

  it("names each missing capability in plain words", () => {
    expect(missingCapabilities({ ...all, hasGetUserMedia: false })).toEqual([
      "microphone access",
    ]);
    expect(missingCapabilities({ ...all, hasRTCPeerConnection: false })).toEqual([
      "live audio calls",
    ]);
    expect(missingCapabilities({ ...all, hasMediaRecorder: false })).toEqual([
      "in-browser recording",
    ]);
  });

  it("lists every gap for a bare webview", () => {
    expect(
      missingCapabilities({
        hasGetUserMedia: false,
        hasRTCPeerConnection: false,
        hasMediaRecorder: false,
      }),
    ).toHaveLength(3);
  });
});

describe("gate and disclosure copy", () => {
  it("says exactly what is missing", () => {
    const message = unsupportedBrowserMessage(["microphone access", "in-browser recording"]);
    expect(message).toContain("microphone access, in-browser recording");
  });

  it("names the supported browsers", () => {
    for (const browser of ["Chrome", "Edge", "Safari", "Firefox"]) {
      expect(SUPPORTED_BROWSERS_LINE).toContain(browser);
    }
  });

  it("pins the recording disclosure line", () => {
    expect(RECORDING_DISCLOSURE).toBe(
      "This session is recorded and scored; kept privately for your replay.",
    );
  });

  it("keeps the whole register calm — no exclamation marks anywhere", () => {
    const copy = [
      AUDIO_START_FAILURE_MESSAGE,
      IN_APP_BROWSER_HINT,
      RECORDER_UNAVAILABLE_MESSAGE,
      RECORDING_DISCLOSURE,
      SUPPORTED_BROWSERS_LINE,
      unsupportedBrowserMessage(["microphone access"]),
      ...Object.values(MIC_FAILURE_LINES),
    ];
    for (const line of copy) {
      expect(line).not.toContain("!");
    }
  });
});
