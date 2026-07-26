import { describe, expect, it } from "vitest";

import * as route from "@/app/api/sessions/[id]/route";

describe("session route exposes no unauthenticated GET", () => {
  it("exports POST and does not export GET", () => {
    expect(typeof route.POST).toBe("function");
    expect((route as Record<string, unknown>).GET).toBeUndefined();
  });
});
