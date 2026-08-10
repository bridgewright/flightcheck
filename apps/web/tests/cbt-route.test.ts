import { beforeEach, describe, expect, it, vi } from "vitest";

const { getViewer, redeemCbtCode } = vi.hoisted(() => ({ getViewer: vi.fn(), redeemCbtCode: vi.fn() }));
vi.mock("@/lib/viewer", () => ({ getViewer }));
vi.mock("@/lib/worker", async () => {
  const actual = await vi.importActual<typeof import("@/lib/worker")>("@/lib/worker");
  return { ...actual, redeemCbtCode };
});

import { POST } from "@/app/api/cbt/redeem/route";
import { WorkerError } from "@/lib/worker";

const request = (body: unknown) => new Request("http://web.test/api/cbt/redeem", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => { getViewer.mockReset(); redeemCbtCode.mockReset(); });

describe("POST /api/cbt/redeem", () => {
  it("requires a signed-in viewer", async () => {
    getViewer.mockResolvedValue(null);
    expect((await POST(request({ code: "BETA" }))).status).toBe(401);
  });

  it("trims and proxies the code for the signed-in user", async () => {
    getViewer.mockResolvedValue({ id: "user-1", email: null });
    redeemCbtCode.mockResolvedValue({ label: "Beta", packages_remaining: 3, package_expires_at: "2026-08-31T00:00:00Z" });
    const response = await POST(request({ code: "  BETA  " }));
    expect(response.status).toBe(200);
    expect(redeemCbtCode).toHaveBeenCalledWith("user-1", "BETA");
  });

  it("passes worker refusal status and code through untranslated", async () => {
    getViewer.mockResolvedValue({ id: "user-1", email: null });
    redeemCbtCode.mockRejectedValue(new WorkerError("POST /api/cbt/redeem", 409, "cbt-full", null));
    const response = await POST(request({ code: "BETA" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: "cbt-full" });
  });
});
