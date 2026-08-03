// Pure helpers for the session room's media plumbing: which browsers can run
// an interview at all, which recording container this browser supports, and
// the honest copy for every way the microphone or recorder can fail. All
// inputs are structural (no DOM globals), so everything here is unit-testable
// and the WebRTC wiring in SessionRoom.tsx stays thin — the same discipline
// as lib/session-room.ts.

// --- Capability gate ------------------------------------------------------

export interface MediaCapabilities {
  hasGetUserMedia: boolean;
  hasRTCPeerConnection: boolean;
  hasMediaRecorder: boolean;
}

/**
 * Plain-words names of the capabilities a browser is missing. Empty means
 * the interview can at least attempt to run. The three checks mirror what
 * the room actually calls: getUserMedia (microphone), RTCPeerConnection
 * (the live audio call), MediaRecorder (the scored recording). In-app
 * webviews (chat and social apps) commonly fail the first check.
 */
export function missingCapabilities(caps: MediaCapabilities): string[] {
  const missing: string[] = [];
  if (!caps.hasGetUserMedia) missing.push("microphone access");
  if (!caps.hasRTCPeerConnection) missing.push("live audio calls");
  if (!caps.hasMediaRecorder) missing.push("in-browser recording");
  return missing;
}

/** One sentence naming exactly what this browser lacks. */
export function unsupportedBrowserMessage(missing: string[]): string {
  return (
    "A live interview needs microphone access, a real-time audio " +
    `connection, and in-browser recording. This browser is missing: ${missing.join(", ")}.`
  );
}

export const SUPPORTED_BROWSERS_LINE =
  "Use a recent version of Chrome, Edge, Safari, or Firefox.";

export const IN_APP_BROWSER_HINT =
  "If this page opened inside another app (a chat or social app's built-in " +
  "browser), open it in your main browser instead.";

// --- Recording container --------------------------------------------------

/**
 * Recording containers in preference order. Chrome, Edge, and Firefox record
 * webm/opus; Safari (macOS and iOS) records only mp4. The scorer transcodes
 * whatever container actually arrives, so the fallback ships a scoreable
 * recording instead of failing the session (the storage key keeps its
 * registry-contract `.webm` name either way — the worker sniffs content,
 * not extensions).
 */
export const RECORDER_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
] as const;

export type RecorderMimeType = (typeof RECORDER_MIME_CANDIDATES)[number];

/**
 * The first recording container this browser supports, or null when none is
 * — the room must surface recorder-unavailable BEFORE minting anything.
 * The probe is passed in structurally; an old MediaRecorder without
 * isTypeSupported gets the default candidate and the construction try/catch
 * nets whatever that implementation refuses.
 */
export function pickRecorderMimeType(
  isTypeSupported: ((type: string) => boolean) | undefined,
): RecorderMimeType | null {
  if (isTypeSupported === undefined) {
    return RECORDER_MIME_CANDIDATES[0];
  }
  for (const candidate of RECORDER_MIME_CANDIDATES) {
    if (isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return null;
}

/** Container half of a mimeType — the Blob/upload Content-Type
 * ("audio/webm;codecs=opus" → "audio/webm"). */
export function containerType(mimeType: string): string {
  return mimeType.split(";")[0].trim();
}

// --- Failure copy ---------------------------------------------------------

export type MicFailureKind = "denied" | "no-device" | "other";

/**
 * Map a getUserMedia DOMException name to the discriminated failure kinds
 * MicCheck established, so the room and the check tell the same truth:
 * blocked permission, missing hardware, and everything else are different
 * problems with different fixes.
 */
export function classifyMicFailure(name: string): MicFailureKind {
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "denied";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "no-device";
  }
  return "other";
}

/** The room's mic-failure copy, one line per kind (MicCheck keeps its own
 * "check again" phrasing; the room retries the interview itself). */
export const MIC_FAILURE_LINES: Record<MicFailureKind, string> = {
  denied:
    "Microphone access is blocked. The interview cannot run without a " +
    "microphone — allow access for this site in your browser settings, " +
    "then try again.",
  "no-device":
    "No microphone was found. Connect one, or pick a different input " +
    "device in your system settings, then try again.",
  other: "The microphone could not be started. Reload the page and try again.",
};

/** Shown when MediaRecorder cannot be built or started: the honest state
 * that replaces the silent permanent "Connecting…" the audit flagged. */
export const RECORDER_UNAVAILABLE_MESSAGE =
  "This browser could not start the audio recorder, so the interview " +
  "cannot begin. Your session was not used. Switch to a recent version of " +
  "Chrome, Edge, Safari, or Firefox and try again.";

/** Shown when the browser's audio system refuses to leave its suspended
 * state inside the start gesture. */
export const AUDIO_START_FAILURE_MESSAGE =
  "The browser's audio system could not be started. Reload the page and " +
  "try again.";

/** One calm line at the mic-check step — recording is disclosed before the
 * session, not discovered after it. */
export const RECORDING_DISCLOSURE =
  "This session is recorded and scored; kept privately for your replay.";
