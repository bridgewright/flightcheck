import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("session coaching wiring", () => {
  it("fetches coaching additively and confines tabs to report states", () => {
    const page = read("app/sessions/[id]/page.tsx");
    expect(page).toContain("getSessionCoaching(id).catch(() => null)");
    expect(page.indexOf("const tabs")).toBeGreaterThan(page.indexOf('state === "scored" || state === "limited"'));
  });

  it("defaults coaching and preserves the verbatim turn text node", () => {
    const view = read("components/TranscriptView.tsx");
    expect(view).toContain("coaching = null");
    expect(view).toContain('<p className={`${MUTED} ${PROSE_WIDTH}`}>{entry.turn.text}</p>');
    expect(view).toContain("attachedCount > 0 ?");
  });

  it("authorizes viewer before calling the worker", () => {
    const actions = read("app/sessions/[id]/actions.ts");
    expect(actions.indexOf("getViewer()")).toBeLessThan(actions.indexOf("setParaphraseMark(sessionId"));
    expect(actions.indexOf("authorizeViewerSession")).toBeLessThan(actions.indexOf("setParaphraseMark(sessionId"));
  });
});
