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
 * live-verified in the webroom harness — keep it.
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
