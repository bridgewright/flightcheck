import { describe, expect, it } from "vitest";

import { clientSecretRequestBody, recordingStoragePath } from "./realtime";

describe("clientSecretRequestBody", () => {
  it("uses the exact nested GA schema (the flat pre-GA schema silently fails)", () => {
    expect(clientSecretRequestBody("You are Morgan.")).toEqual({
      session: {
        type: "realtime",
        model: "gpt-realtime",
        instructions: "You are Morgan.",
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
    });
  });
});

describe("recordingStoragePath", () => {
  it("builds the contract storage path inside the recordings bucket", () => {
    expect(recordingStoragePath("pkg-123", 1)).toBe(
      "packages/pkg-123/session-1.webm",
    );
  });
});
