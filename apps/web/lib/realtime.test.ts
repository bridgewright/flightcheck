import { describe, expect, it } from "vitest";

import {
  MAX_RECORDING_BYTES,
  clientSecretRequestBody,
  isValidPackageId,
  isValidSessionIndex,
  recordingStoragePath,
} from "./realtime";

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
              create_response: false,
              threshold: 0.6,
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

describe("isValidPackageId", () => {
  it("accepts a canonical postgres uuid", () => {
    expect(isValidPackageId("a3bb189e-8bf9-4888-9912-ace4e6543002")).toBe(true);
  });

  it("rejects non-uuid and path-traversal shapes", () => {
    expect(isValidPackageId("pkg-123")).toBe(false);
    expect(isValidPackageId("../../etc/passwd")).toBe(false);
    expect(isValidPackageId("")).toBe(false);
    expect(isValidPackageId("a3bb189e-8bf9-4888-9912-ace4e6543002/evil")).toBe(
      false,
    );
  });
});

describe("isValidSessionIndex", () => {
  it("accepts small positive integers", () => {
    expect(isValidSessionIndex(1)).toBe(true);
    expect(isValidSessionIndex(99)).toBe(true);
  });

  it("rejects zero, negatives, fractions, huge values, and NaN", () => {
    expect(isValidSessionIndex(0)).toBe(false);
    expect(isValidSessionIndex(-1)).toBe(false);
    expect(isValidSessionIndex(1.5)).toBe(false);
    expect(isValidSessionIndex(100)).toBe(false);
    expect(isValidSessionIndex(Number.NaN)).toBe(false);
  });
});

describe("MAX_RECORDING_BYTES", () => {
  it("caps recording uploads at 50 MB", () => {
    expect(MAX_RECORDING_BYTES).toBe(50 * 1024 * 1024);
  });
});
