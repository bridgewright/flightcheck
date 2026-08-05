import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// F-66, the client half: a session that has already ended never shows a
// start card, and a stale tab that tries anyway lands on the truth. The
// room page and SessionRoom are server/client components with no render
// harness (environment: node), so this is a source-scan contract in the
// house style, like mic-recovery.test.ts.
//
// What it holds: the room page branches on endedRoomNotice(status) BEFORE
// the capability gate (whose copy promises "not scored", a lie for a scored
// row) and renders the notice with a home door; SessionRoom's mint failure
// path keys on the session-not-live CODE, not on error text, and reloads so
// the server-rendered page decides the screen; and the connection-lost copy
// stays reserved for genuine mid-session loss.

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(join(webRoot, rel), "utf8");

/** Source with comments blanked out, line count preserved (mic-recovery
 * idiom): the pins are about what a component does, not what it explains. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, before: string) =>
      before + match.slice(before.length).replace(/./g, " "),
    );
}

const roomPageSource = read("app/sessions/[id]/room/page.tsx");
const roomPage = withoutComments(roomPageSource);
const sessionRoomSource = read("components/SessionRoom.tsx");
const sessionRoom = withoutComments(sessionRoomSource);

describe("the room page refuses a session that has already ended", () => {
  it("keys the branch on the session status through endedRoomNotice", () => {
    expect(roomPage).toContain(
      "endedRoomNotice(access.value.session.status)",
    );
  });

  it("decides the ended branch before the capability gate", () => {
    // The capability screen promises the session "has not been scored and
    // does not count against your package" — true for an expired token,
    // false for a scored or insufficient row. Status is the stronger fact,
    // so it is read first.
    const noticeAt = roomPage.indexOf("endedRoomNotice(");
    const capabilityAt = roomPage.indexOf("sessionCapability(");
    expect(noticeAt).toBeGreaterThan(-1);
    expect(capabilityAt).toBeGreaterThan(-1);
    expect(noticeAt).toBeLessThan(capabilityAt);
  });

  it("renders the notice copy from the helper, never its own literals", () => {
    expect(roomPage).toContain("{notice.headline}");
    expect(roomPage).toContain("{notice.detail}");
  });

  it("offers the home door, and the session page only when the helper says so", () => {
    expect(roomPage).toContain('href="/home"');
    expect(roomPage).toContain("notice.showSessionLink");
    expect(roomPage).toMatch(/href=\{`\/sessions\/\$\{id\}`\}/);
  });

  it("still renders the live room for a planned session", () => {
    expect(roomPage).toContain("<SessionRoom");
  });
});

describe("SessionRoom treats the mint 409 as an ended session, not an error", () => {
  it("keys on the session-not-live code, never on error text", () => {
    expect(sessionRoom).toContain('secretBody.code === "session-not-live"');
    expect(sessionRoom).toContain("secretRes.status === 409");
  });

  it("reloads so the server-rendered page owns the ended screen", () => {
    // One screen, one source of truth: the page re-reads the status and
    // renders the same notice a fresh visit would get. The reload sits in
    // the guarded branch and returns before the generic connect error.
    const branch = sessionRoom.slice(
      sessionRoom.indexOf('secretBody.code === "session-not-live"'),
      sessionRoom.indexOf("const { value: ephemeral }"),
    );
    expect(branch).toContain("window.location.reload()");
    expect(branch).toContain("return;");
  });

  it("keeps the connection-lost copy reserved for the guard's endings", () => {
    // Exactly one render site, in the connection-lost phase — the ended
    // session must never borrow it again.
    expect(sessionRoom.match(/CONNECTION_LOST_MESSAGE/g)).toHaveLength(2);
    expect(sessionRoom).toMatch(
      /phase === "connection-lost"[\s\S]*CONNECTION_LOST_MESSAGE/,
    );
  });
});

describe("copy hygiene on the new surfaces", () => {
  it("the room page emits no typographic dashes (comments may explain)", () => {
    // Scanned with comments blanked: the house comment style uses em
    // dashes freely, and the gate is about what a reader of the PAGE sees.
    expect(roomPage).not.toMatch(/[–—]/);
  });
});
