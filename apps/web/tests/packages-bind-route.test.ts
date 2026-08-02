import { beforeEach, describe, expect, it, vi } from "vitest";

// Binding is the one place a package changes hands, so these tests pin the two
// properties that keep it safe: the owner comes from the session rather than
// the request body, and an already-owned package is never reassigned.

const { getViewer, calls, result } = vi.hoisted(() => ({
  getViewer: vi.fn(),
  calls: [] as { method: string; args: unknown[] }[],
  result: {
    data: null as { id: string }[] | null,
    error: null as { message: string } | null,
  },
}));

vi.mock("@/lib/viewer", () => ({ getViewer }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from(table: string) {
      calls.push({ method: "from", args: [table] });
      const builder = {
        update(values: unknown) {
          calls.push({ method: "update", args: [values] });
          return builder;
        },
        eq(column: string, value: unknown) {
          calls.push({ method: "eq", args: [column, value] });
          return builder;
        },
        is(column: string, value: unknown) {
          calls.push({ method: "is", args: [column, value] });
          return builder;
        },
        select(columns: string) {
          calls.push({ method: "select", args: [columns] });
          return Promise.resolve(result);
        },
      };
      return builder;
    },
  }),
}));

import { POST } from "@/app/api/packages/bind/route";

function jsonRequest(body: unknown): Request {
  return new Request("http://web.test/api/packages/bind", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function call(method: string) {
  return calls.find((entry) => entry.method === method);
}

beforeEach(() => {
  getViewer.mockReset();
  calls.length = 0;
  result.data = [];
  result.error = null;
});

describe("POST /api/packages/bind", () => {
  it("rejects a request without a token", async () => {
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(400);
    expect(getViewer).not.toHaveBeenCalled();
  });

  it("rejects an anonymous caller without touching the database", async () => {
    getViewer.mockResolvedValue(null);
    const res = await POST(jsonRequest({ token: "tok-1" }));
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("claims the package for the session's user, ignoring any user_id sent", async () => {
    getViewer.mockResolvedValue({ id: "viewer-1", email: "tae@example.com" });
    result.data = [{ id: "pkg-1" }];
    const res = await POST(
      jsonRequest({ token: "tok-1", user_id: "someone-else" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ bound: true });
    expect(call("update")?.args[0]).toEqual({ user_id: "viewer-1" });
    expect(call("eq")?.args).toEqual(["access_token", "tok-1"]);
  });

  it("never reassigns a package that already has an owner", async () => {
    getViewer.mockResolvedValue({ id: "viewer-1", email: null });
    result.data = [];
    const res = await POST(jsonRequest({ token: "tok-1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ bound: false });
    // The null-owner predicate is what makes that true in the database.
    expect(call("is")?.args).toEqual(["user_id", null]);
  });

  it("returns a generic 502 without echoing the database error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      getViewer.mockResolvedValue({ id: "viewer-1", email: null });
      result.data = null;
      result.error = { message: "relation packages exploded: internal detail" };
      const res = await POST(jsonRequest({ token: "tok-1" }));
      expect(res.status).toBe(502);
      const body = (await res.json()) as { error: string };
      expect(body.error).not.toContain("exploded");
    } finally {
      errorSpy.mockRestore();
    }
  });
});
