// Pure request shaping for the server routes (house pattern: shape requests
// in a pure function so they can be unit-tested without minting anything).

/**
 * Body for POST https://api.openai.com/v1/realtime/client_secrets.
 *
 * Hard-won GA fact (W1 bake-off): this endpoint wants the NESTED session
 * schema — `session.type: "realtime"` and `turn_detection` under
 * `session.audio.input`. The flat pre-GA schema silently fails: the request
 * succeeds but turn_detection is ignored, the VAD tail stays at the ~500 ms
 * server default, and the interviewer talks over the candidate's thinking
 * pauses. 900 ms tail + 300 ms prefix padding is the bake-off-validated
 * setting (global constraint). `output_modalities: ["audio"]` was
 * live-verified in the webroom harness — keep it. With
 * `create_response: false` the server commits turns but never responds on its
 * own — the client owns all response timing (DECISIONS 009).
 */
export function clientSecretRequestBody(instructions: string) {
  return {
    session: {
      type: "realtime",
      model: "gpt-realtime",
      instructions,
      output_modalities: ["audio"],
      audio: {
        input: {
          turn_detection: {
            type: "server_vad",
            silence_duration_ms: 900,
            prefix_padding_ms: 300,
            create_response: false,
            // Raised from the 0.5 default (2026-08-01 diagnostic run):
            // ambient room noise in the open-speakers environment was
            // committing phantom turns every ~10 s and each one triggered a
            // response. Real speech clears 0.6 comfortably.
            threshold: 0.6,
            // Off for the same reason create_response is off: on open
            // speakers, Morgan's own leaked audio trips VAD at utterance
            // onset (logged 1.7 s into the greeting) and the default
            // server-side interruption truncated his first words — heard
            // as broken audio. Yielding on overlap is handled in the
            // interviewer instructions (follow the candidate's thread),
            // not by chopping the audio stream.
            interrupt_response: false,
          },
        },
        output: { voice: "marin" },
      },
    },
  };
}

/**
 * Path of a session recording inside the Supabase Storage bucket
 * "recordings" (registry contract — the worker's Storage.download_recording
 * reads this exact path when scoring).
 */
export function recordingStoragePath(
  packageId: string,
  sessionIndex: number,
): string {
  return `packages/${packageId}/session-${sessionIndex}.webm`;
}

/**
 * Upload cap for one session recording. 25 minutes of opus at MediaRecorder
 * defaults is well under 25 MB; 50 MB is a generous ceiling that still stops
 * a hostile client from streaming gigabytes through the service-role upload
 * path.
 */
export const MAX_RECORDING_BYTES = 50 * 1024 * 1024;

/**
 * Server-side ceiling on a recording that has already reached storage. Set
 * above MAX_RECORDING_BYTES on purpose: the browser cap is the one that
 * shapes honest uploads, and this one only has to catch a client that
 * ignored it. The 10 MB of headroom keeps an edge-case honest upload — a
 * container quirk, a long overtime session — from being refused after the
 * interview is already over and unrepeatable.
 */
export const MAX_STORED_RECORDING_BYTES = 60 * 1024 * 1024;

// packages.id is a Postgres gen_random_uuid() column
// (docs/supabase/migrations/001_init.sql), so anything that is not a
// canonical UUID is hostile input. Validating BEFORE storage-key
// interpolation keeps path traversal out of the recordings bucket.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when the value is a canonical UUID (the worker's package id shape). */
export function isValidPackageId(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * True for a plausible session index: a small positive integer. v0.1
 * packages hold a handful of sessions; 99 is a generous ceiling that keeps
 * the storage key bounded.
 */
export function isValidSessionIndex(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 99;
}
