import { beforeEach, describe, expect, it, vi } from "vitest";

const { getViewer, submitFeedback } = vi.hoisted(() => ({ getViewer: vi.fn(), submitFeedback: vi.fn() }));
vi.mock("@/lib/viewer", () => ({ getViewer }));
vi.mock("@/lib/worker", () => ({ submitFeedback }));

import { submitFeedbackAction } from "@/app/feedback/actions";

function form(entries: Record<string, string>) { const data = new FormData(); Object.entries(entries).forEach(([key, value]) => data.set(key, value)); return data; }

beforeEach(() => { getViewer.mockReset(); getViewer.mockResolvedValue({ id: "viewer-1", email: null }); submitFeedback.mockReset(); submitFeedback.mockResolvedValue({ feedback_id: "f-1" }); });

describe("submitFeedbackAction", () => {
  it("refuses signed-out callers", async () => { getViewer.mockResolvedValue(null); expect(await submitFeedbackAction({ ok: false }, form({ rating: "4" }))).toEqual({ ok: false, error: "sign-in" }); expect(submitFeedback).not.toHaveBeenCalled(); });
  it("refuses invalid ratings", async () => { expect((await submitFeedbackAction({ ok: false }, form({ rating: "0.3" }))).ok).toBe(false); expect(submitFeedback).not.toHaveBeenCalled(); });
  it("turns worker failure into a calm result", async () => { submitFeedback.mockRejectedValue(new Error("down")); expect((await submitFeedbackAction({ ok: false }, form({ rating: "4", body: "hi" }))).ok).toBe(false); });
  it("uses only the authenticated user id", async () => { const data = form({ rating: "3.5", body: "hi", user_id: "attacker" }); expect(await submitFeedbackAction({ ok: false }, data)).toEqual({ ok: true }); expect(submitFeedback).toHaveBeenCalledWith({ user_id: "viewer-1", rating_half_stars: 7, body: "hi", package_id: undefined }); });
});
