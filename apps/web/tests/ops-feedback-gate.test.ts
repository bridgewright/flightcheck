import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getViewer, setFeedbackStatus, revalidatePath } = vi.hoisted(() => ({ getViewer: vi.fn(), setFeedbackStatus: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/viewer", () => ({ getViewer }));
vi.mock("@/lib/worker", () => ({ setFeedbackStatus }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { updateFeedbackStatusAction } from "@/app/ops/feedback/actions";

beforeEach(() => { getViewer.mockReset(); setFeedbackStatus.mockReset(); revalidatePath.mockReset(); process.env.OPERATOR_USER_ID = "operator-1"; });

describe("operator feedback gate", () => {
  it("refuses a direct non-operator action call", async () => { getViewer.mockResolvedValue({ id: "other" }); expect((await updateFeedbackStatusAction("f-1", "seen")).ok).toBe(false); expect(setFeedbackStatus).not.toHaveBeenCalled(); });
  it("lets the operator update and revalidates", async () => { getViewer.mockResolvedValue({ id: "operator-1" }); expect(await updateFeedbackStatusAction("f-1", "seen")).toEqual({ ok: true }); expect(setFeedbackStatus).toHaveBeenCalledWith("f-1", "seen"); expect(revalidatePath).toHaveBeenCalledWith("/ops/feedback"); });
  it("pins page authorization and row rendering wiring", () => { const source = fs.readFileSync(path.join(process.cwd(), "app/ops/feedback/page.tsx"), "utf8"); expect(source).toContain("isOperator(viewer?.id"); expect(source).toContain("notFound()"); expect(source).toContain("rows.map"); });
});
