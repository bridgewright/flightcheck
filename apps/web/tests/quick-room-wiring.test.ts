import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");

// The room has no render harness (environment: node, no jsdom — see
// tests/room-token-hygiene.test.ts, which reads source for the same reason),
// so these are source gates.
//
// They are written the way they are because the first version of this file
// was not a gate. It asserted that a handful of strings appeared somewhere in
// the file, and seven separate mutations of the parametrization it exists to
// protect left the whole suite green: the default budget changed to 600, the
// hard cut dropped its threaded argument, donePath defaulted to "/", the
// closing arm and the timer line went back to reading the module constant,
// and the two package filters were deleted. A pin that survives the drift it
// names is decoration.
//
// So the shape below is: pin the defaults exactly, then forbid the constants
// anywhere else in the component. The second half is what does the work — it
// is not possible to un-thread a prop without putting the constant back.

const ROOM = read("components/SessionRoom.tsx");

describe("quick room wiring", () => {
  it("defaults every timing prop to the standard-room constant", () => {
    // Byte-identical default behaviour is the whole contract for the 20-minute
    // room: it must not be able to notice that the quick path exists.
    expect(ROOM).toContain("budgetS = SESSION_BUDGET_S,");
    expect(ROOM).toContain("hardCutS = HARD_CUT_S,");
    expect(ROOM).toContain("unscored = false,");
    expect(ROOM).toContain("donePath = reportHref,");
  });

  it("reads the session constants only as those defaults", () => {
    const uses = ROOM.split("\n")
      .map((line, index) => ({ line: line.trim(), number: index + 1 }))
      .filter(({ line }) => /\b(SESSION_BUDGET_S|HARD_CUT_S)\b/.test(line))
      .filter(({ line }) => !/^(budgetS|hardCutS) =/.test(line))
      // the import block
      .filter(({ line }) => !/^(SESSION_BUDGET_S|HARD_CUT_S),$/.test(line))
      .map(({ line, number }) => `SessionRoom.tsx:${number}: ${line}`);
    expect(
      uses,
      "every timing read in the room body goes through the budgetS/hardCutS props, or the quick session silently runs on the 20-minute clock",
    ).toEqual([]);
  });

  it("threads the props through every timing decision", () => {
    expect(ROOM).toContain("isHardCut(elapsed, hardCutS)");
    expect(ROOM).toContain("closingArmedAt(budgetS)");
    expect(ROOM).toContain("timeStatusCheckpoints(budgetS)");
    expect(ROOM).toContain("{formatTimer(budgetS)} planned");
    expect(ROOM).toContain("{formatTimer(hardCutS)}");
  });

  it("passes the quick pair, unscored, and the pitch page from the room page", () => {
    const page = read("app/sessions/[id]/room/page.tsx");
    for (const pin of [
      "QUICK_SESSION_BUDGET_S",
      "QUICK_HARD_CUT_S",
      "unscored: true",
      "donePath: `/quick/report/${access.value.session.package_id}`",
    ]) {
      expect(page).toContain(pin);
    }
  });

  it("constructs no recorder and mints no upload URL in unscored mode", () => {
    expect(ROOM).toContain("if (unscored) {");
    expect(ROOM.indexOf("if (unscored) {")).toBeLessThan(
      ROOM.indexOf("new MediaRecorder"),
    );
    // The only two calls that put a recording on the server. Both live in
    // uploadAndComplete, and the unscored path returns before reaching it.
    const upload = ROOM.slice(
      ROOM.indexOf("const uploadAndComplete"),
      ROOM.indexOf("const endSession"),
    );
    expect(upload).toContain('fetch("/api/recordings"');
    expect(ROOM.split('fetch("/api/recordings"')).toHaveLength(2);
    expect(ROOM).toContain("await completeUnscored();");
  });

  it("keeps the recording screens off the unscored ending", () => {
    // "Saving your recording and starting the scoring run…", the unload
    // dialog's "your recording is about to be lost", and the upload retry
    // button all hang off phase "uploading". An unscored session that set
    // that phase would show all three to someone the same room just told it
    // was not recording or scoring them.
    const ending = ROOM.slice(ROOM.indexOf("const completeUnscored"));
    expect(ending.slice(0, ending.indexOf("const endSession"))).toContain(
      'setPhase("completing")',
    );
    expect(ROOM).not.toContain('unscored) {\n      setPhase("uploading")');
    expect(ROOM).toContain('phase === "completing"');
  });

  it("gates an unscored room on the capabilities it actually needs", () => {
    // Not on MediaRecorder, which it does not use — but still on the mic and
    // the real-time connection, which it does. The quick interview is the
    // funnel's front door: skipping the gate entirely sends an in-app browser
    // into a mic check that cannot succeed, with no copy explaining why.
    expect(ROOM).toContain("<BrowserGate requireRecorder={!unscored}>");
    const gate = read("components/BrowserGate.tsx");
    expect(gate).toContain("hasGetUserMedia:");
    expect(gate).toContain("hasRTCPeerConnection:");
    expect(gate).toContain(
      "hasMediaRecorder: !requireRecorder || typeof MediaRecorder !== \"undefined\"",
    );
  });
});
