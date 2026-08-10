import { describe, expect, it } from "vitest";

import { isStillSurface, ROUTE_CANVAS, routeCanvasClass } from "./route";

// Which routes the route-enter canvas covers, decided in one pure function so
// the exclusion is a property a test can hold rather than a class attribute
// spread over templates. The session room is user-excluded (F-50): an
// interview gets a still screen, and nothing in this track may reach it.

describe("the still surface: the session room, and only the session room", () => {
  it("keeps the room still", () => {
    expect(isStillSurface("/sessions/abc123/room")).toBe(true);
    expect(isStillSurface("/sessions/9f8e7d/room/")).toBe(true);
  });

  it("covers every other surface, signed-in and marketing alike", () => {
    for (const pathname of [
      "/",
      "/home",
      "/sessions",
      "/sessions/abc123",
      "/progress",
      "/rubric",
      "/settings",
      "/packages",
      "/pricing",
      "/faq",
      "/login",
      "/quick",
      "/new",
      "/checkout",
      "/sample-report",
      "/p/tok/report/1",
      "/p/tok/session/1",
    ]) {
      expect(isStillSurface(pathname), pathname).toBe(false);
    }
  });

  it("does not mistake a session named room for the room", () => {
    // /sessions/room is a session detail whose id happens to be "room"; only
    // the three-segment room address is the excluded surface.
    expect(isStillSurface("/sessions/room")).toBe(false);
  });
});

describe("the canvas class the template applies", () => {
  it("is the one global scope class, named here and nowhere else", () => {
    expect(ROUTE_CANVAS).toBe("route-canvas");
  });

  it("is granted to every covered surface and withheld from the room", () => {
    expect(routeCanvasClass("/home")).toBe(ROUTE_CANVAS);
    expect(routeCanvasClass("/")).toBe(ROUTE_CANVAS);
    expect(routeCanvasClass("/sessions/abc123")).toBe(ROUTE_CANVAS);
    expect(routeCanvasClass("/sessions/abc123/room")).toBeUndefined();
  });
});
