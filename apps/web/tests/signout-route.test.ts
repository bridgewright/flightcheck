import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /auth/signout signs the account out and redirects. The optional `next`
// form field exists for the S15 403 page ("Switch account" must come back to
// the package link so the user re-enters as the right account); every other
// signout form omits it and keeps landing on "/". `next` is an attacker-
// reachable redirect target, so only same-origin paths may pass.

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));

vi.mock("../lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signOut } }),
}));

import { POST } from "@/app/auth/signout/route";

function formPost(fields?: Record<string, string>): Request {
  return new Request("http://web.test/auth/signout", {
    method: "POST",
    body: new URLSearchParams(fields ?? {}),
  });
}

beforeEach(() => {
  signOut.mockReset();
  signOut.mockResolvedValue({ error: null });
});

describe("POST /auth/signout", () => {
  it("signs out and lands on / when no next field is sent", async () => {
    const res = await POST(formPost());
    expect(signOut).toHaveBeenCalledTimes(1);
    // 303: after a form POST the browser must follow with a GET.
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/");
  });

  it("lands on / when the request has no form body at all", async () => {
    const res = await POST(
      new Request("http://web.test/auth/signout", { method: "POST" }),
    );
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/");
  });

  it("follows a same-origin next path (the S15 switch-account flow)", async () => {
    const res = await POST(formPost({ next: "/p/tok-abc" }));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.origin).toBe("http://web.test");
    expect(location.pathname).toBe("/p/tok-abc");
  });

  it("rejects an absolute next URL", async () => {
    const res = await POST(formPost({ next: "https://evil.example/phish" }));
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.origin).toBe("http://web.test");
    expect(location.pathname).toBe("/");
  });

  it("rejects a protocol-relative next value", async () => {
    const res = await POST(formPost({ next: "//evil.example/phish" }));
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.origin).toBe("http://web.test");
    expect(location.pathname).toBe("/");
  });

  it("rejects a backslash next value that WHATWG parsing sends off-origin", async () => {
    // new URL("/\\evil.example/phish", base) resolves to http://evil.example
    // because the URL parser treats "\" as "/" for http(s).
    const res = await POST(formPost({ next: "/\\evil.example/phish" }));
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.origin).toBe("http://web.test");
    expect(location.pathname).toBe("/");
  });

  it("rejects an empty next value", async () => {
    const res = await POST(formPost({ next: "" }));
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/");
  });
});
