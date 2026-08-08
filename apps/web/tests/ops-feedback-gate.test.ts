import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getViewer, setFeedbackStatus, listFeedback, revalidatePath, notFound } = vi.hoisted(() => ({ getViewer: vi.fn(), setFeedbackStatus: vi.fn(), listFeedback: vi.fn(), revalidatePath: vi.fn(), notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }) }));
vi.mock("@/lib/viewer", () => ({ getViewer }));
vi.mock("@/lib/worker", () => ({ setFeedbackStatus, listFeedback }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ notFound }));

import OperatorFeedbackPage from "@/app/ops/feedback/page";
import { updateFeedbackStatusAction } from "@/app/ops/feedback/actions";

beforeEach(() => { getViewer.mockReset(); setFeedbackStatus.mockReset(); listFeedback.mockReset(); listFeedback.mockResolvedValue([]); revalidatePath.mockReset(); notFound.mockClear(); process.env.OPERATOR_USER_ID = "operator-1"; });

describe("operator feedback gate", () => {
  it("refuses a direct non-operator action call", async () => { getViewer.mockResolvedValue({ id: "other" }); expect((await updateFeedbackStatusAction("f-1", "seen")).ok).toBe(false); expect(setFeedbackStatus).not.toHaveBeenCalled(); });
  it("lets the operator update and revalidates", async () => { getViewer.mockResolvedValue({ id: "operator-1" }); expect(await updateFeedbackStatusAction("f-1", "seen")).toEqual({ ok: true }); expect(setFeedbackStatus).toHaveBeenCalledWith("f-1", "seen"); expect(revalidatePath).toHaveBeenCalledWith("/ops/feedback"); });
  // The page gate, exercised rather than grepped: a non-operator must be gone
  // before any feedback is fetched, so a stray render cannot leak other
  // customers' words even if the markup below it were wrong.
  it("sends a non-operator to notFound without reading the inbox", async () => { getViewer.mockResolvedValue({ id: "other" }); await expect(OperatorFeedbackPage()).rejects.toThrow("NEXT_NOT_FOUND"); expect(notFound).toHaveBeenCalled(); expect(listFeedback).not.toHaveBeenCalled(); });
  it("treats an unset OPERATOR_USER_ID as nobody", async () => { delete process.env.OPERATOR_USER_ID; getViewer.mockResolvedValue({ id: "operator-1" }); await expect(OperatorFeedbackPage()).rejects.toThrow("NEXT_NOT_FOUND"); expect(listFeedback).not.toHaveBeenCalled(); });
  it("signs the operator in and loads the inbox", async () => { getViewer.mockResolvedValue({ id: "operator-1" }); await OperatorFeedbackPage(); expect(notFound).not.toHaveBeenCalled(); expect(listFeedback).toHaveBeenCalled(); });
  it("pins page authorization and row rendering wiring", () => { const source = fs.readFileSync(path.join(process.cwd(), "app/ops/feedback/page.tsx"), "utf8"); expect(source).toContain("isOperator(viewer?.id"); expect(source).toContain("notFound()"); expect(source).toContain("rows.map"); });
});
