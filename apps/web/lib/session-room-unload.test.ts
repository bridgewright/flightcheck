import { describe, expect, it } from "vitest";

import { ROOM_PHASES, unloadWarningFor, type RoomPhase } from "./session-room";

describe("unloadWarningFor", () => {
  it("warns while the recording is still uploading", () => {
    // The blob lives only in this tab until the PUT to storage finishes.
    // Closing here loses an interview that cannot be redone.
    const warning = unloadWarningFor("uploading");
    expect(warning).not.toBeNull();
    expect(warning).toContain("recording");
  });

  it("warns while the interview is live", () => {
    const warning = unloadWarningFor("live");
    expect(warning).not.toBeNull();
    expect(warning).toContain("interview");
  });

  it("stays silent when there is nothing to lose", () => {
    expect(unloadWarningFor("ready")).toBeNull();
    expect(unloadWarningFor("connecting")).toBeNull();
    expect(unloadWarningFor("done")).toBeNull();
    expect(unloadWarningFor("connection-lost")).toBeNull();
  });

  it("covers every room phase, so a new phase cannot be forgotten", () => {
    for (const phase of ROOM_PHASES) {
      expect(() => unloadWarningFor(phase)).not.toThrow();
    }
    expect(ROOM_PHASES).toContain("uploading");
  });

  it("keeps the honest, calm register", () => {
    for (const phase of ROOM_PHASES) {
      const warning = unloadWarningFor(phase as RoomPhase);
      if (warning === null) continue;
      expect(warning).not.toContain("!");
      expect(warning.length).toBeLessThan(160);
    }
  });
});
