import { Star, StarHalf } from "@phosphor-icons/react/dist/ssr";
import { notFound } from "next/navigation";

import Shell from "@/components/Shell";
import { updateFeedbackStatusAction } from "./actions";
import { starGlyphs } from "@/lib/feedback";
import { formatSessionDate } from "@/lib/home";
import { isOperator } from "@/lib/operator";
import { CHIP, CHIP_BLUSH, EMPTY_RULE, FINE_PRINT, MUTED, PAGE_HEADING, SECONDARY_BUTTON, TABLE_HEAD, TABLE_ROW } from "@/lib/ui";
import { getViewer } from "@/lib/viewer";
import { listFeedback } from "@/lib/worker";
import type { FeedbackStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

function Rating({ halfStars }: { halfStars: number }) {
  const value = halfStars / 2;
  return <span className="flex text-ink" aria-label={`${value} out of 5 stars`}>{starGlyphs(value).map((glyph, index) => {
    const Icon = glyph === "half" ? StarHalf : Star;
    return <Icon aria-hidden="true" key={index} size={16} weight={glyph === "empty" ? "regular" : "fill"} className={glyph === "empty" ? "text-ink-faint" : "text-ink"} />;
  })}</span>;
}

const nextStatus: Partial<Record<FeedbackStatus, FeedbackStatus>> = { new: "seen", seen: "archived" };

async function advanceStatus(feedbackId: string, status: string) {
  "use server";
  await updateFeedbackStatusAction(feedbackId, status);
}

export default async function OperatorFeedbackPage() {
  const viewer = await getViewer();
  if (!isOperator(viewer?.id, process.env.OPERATOR_USER_ID)) notFound();
  const rows = await listFeedback(undefined, 200);
  return <Shell viewer={viewer} width="wide"><h1 className={PAGE_HEADING}>Feedback inbox</h1>{rows.length === 0 ? <p className="mt-10"><span className={EMPTY_RULE} aria-hidden="true" /> No feedback yet.</p> : <div className="mt-8 overflow-x-auto"><table className="w-full text-left"><thead><tr className={TABLE_HEAD}><th className="pb-3">Date</th><th className="pb-3">Rating</th><th className="pb-3">Feedback</th><th className="pb-3">Submitter</th><th className="pb-3">Status</th><th className="pb-3">Action</th></tr></thead><tbody>{rows.map((row) => { const advance = nextStatus[row.status]; return <tr key={row.id} className={TABLE_ROW}><td className="py-4 pr-4">{formatSessionDate(row.created_at) ?? <span className={EMPTY_RULE} aria-hidden="true" />}</td><td className="py-4 pr-4"><Rating halfStars={row.rating_half_stars} /></td><td className="max-w-xl whitespace-pre-wrap py-4 pr-4">{row.body || <span className={EMPTY_RULE} aria-label="No written feedback" />}</td><td className={`${FINE_PRINT} py-4 pr-4`}>{row.user_id}</td><td className="py-4 pr-4"><span className={`${row.status === "new" ? CHIP_BLUSH : CHIP} ${row.status === "archived" ? MUTED : ""}`}>{row.status}</span></td><td className="py-4">{advance && <form action={advanceStatus.bind(null, row.id, advance)}><button className={SECONDARY_BUTTON}>Mark {advance}</button></form>}</td></tr>; })}</tbody></table></div>}</Shell>;
}
