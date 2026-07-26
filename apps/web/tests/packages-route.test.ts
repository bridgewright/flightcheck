import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Tripwire (mirrors sessions-route.test.ts): GET /api/packages/[token] once
// proxied the raw worker PackageRow to the browser — including
// rubric.question_bank (every interview question plus its follow-up probes),
// the BARS anchors, jd_text, and an echo of the access token. That is the
// answer key of the interview: any token holder could read the questions
// before taking the session, defeating the containment the sessions route
// states explicitly. The route was dead code (the package page reads the
// worker server-side; PollRefresh uses router.refresh()) and was deleted.
//
// If a client-side package poll is ever needed, add a route that returns a
// projected shape ONLY: {id, status, rubric: {role_title, company,
// dimensions: [{key, name, weight, channel, signals}]}} — never
// question_bank, research_summary, anchors, jd_text, or access_token.
describe("no browser-reachable package proxy route", () => {
  it("app/api/packages/[token] stays deleted", () => {
    const routeDir = fileURLToPath(
      new URL("../app/api/packages/[token]", import.meta.url),
    );
    expect(existsSync(routeDir)).toBe(false);
  });
});
