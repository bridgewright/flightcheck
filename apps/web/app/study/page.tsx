import { cookies } from "next/headers";
import Link from "next/link";
import GenerateStudyButton from "@/components/GenerateStudyButton";
import PollRefresh from "@/components/PollRefresh";
import Shell from "@/components/Shell";
import StudyGuideView from "@/components/StudyGuideView";
import { sessionHeading } from "@/components/study-view";
import { generateStudyAction } from "@/app/study/actions";
import { resolveActivePackage } from "@/lib/active-package";
import { scoredCount, staleLine, studyState } from "@/lib/study";
import type { PackageBookmarks } from "@/lib/types";
import { CARD, CHIP_BLUSH, EVIDENCE_QUOTE, LINK, MUTED, NOTICE, PAGE_HEADING, PRIMARY_BUTTON, SECONDARY_BUTTON, SUB_HEADING, SUBTLE } from "@/lib/ui";
import { getViewer } from "@/lib/viewer";
import { getPackageBookmarks, getPackageProgress, getPackageStudy, listPackagesForUser } from "@/lib/worker";

export const dynamic = "force-dynamic";

function SavedOnly({ bookmarks }: { bookmarks: PackageBookmarks | null }) {
  if (!bookmarks?.sessions.length) return null;
  return <section className="mt-10 space-y-4"><h2 className={SUB_HEADING}>Saved from your sessions</h2>{bookmarks.sessions.map((session) => <div key={session.session_id}><Link className={LINK} href={`/sessions/${session.session_id}?tab=study`}>{sessionHeading(session.session_index)}</Link>{session.items.map((item) => <article className={`${CARD} mt-2 space-y-2 p-4`} key={item.turn_index}><blockquote className={EVIDENCE_QUOTE}>{item.source_quote}</blockquote><p>{item.suggestion}</p><p className={SUBTLE}>{item.why}</p></article>)}</div>)}</section>;
}

export default async function StudyPage({ searchParams }: { searchParams: Promise<{ pkg?: string | string[] }> }) {
  const viewer = await getViewer();
  if (!viewer) return <Shell viewer={null}><h1 className={PAGE_HEADING}>You need to sign in to study.</h1><Link className={PRIMARY_BUTTON} href="/login?next=/study">Sign in</Link></Shell>;
  const packages = await listPackagesForUser(viewer.id).catch(() => []);
  const raw = (await searchParams).pkg;
  const active = resolveActivePackage(packages, Array.isArray(raw) ? raw[0] : raw, (await cookies()).get("fc_pkg")?.value);
  if (!active) return <Shell viewer={viewer}><h1 className={PAGE_HEADING}>Study material starts with a package.</h1><Link className={PRIMARY_BUTTON} href="/new">Create a package</Link></Shell>;
  const [study, progress, bookmarks] = await Promise.all([
    getPackageStudy(active.id).catch(() => null),
    getPackageProgress(active.id).catch(() => null),
    getPackageBookmarks(active.id).catch(() => null),
  ]);
  const count = scoredCount(progress?.sessions ?? []);
  const state = studyState(study, count);
  const doc = study?.doc ?? null;
  return <Shell viewer={viewer}><h1 className={PAGE_HEADING}>Study</h1>
    {state === "no_sessions" ? <><p className={MUTED}>Study material is built from your scored sessions.</p><Link className={LINK} href="/home">Start a session</Link></> : null}
    {state === "not_generated" ? <div className="mt-4 space-y-4"><p className={MUTED}>{study === null ? "Study material is briefly unavailable. Refresh and try again." : "Build recurring problems, a practice strategy, and answers from your scored sessions."}</p>{study !== null ? <GenerateStudyButton packageId={active.id} label="Generate study material" className={PRIMARY_BUTTON} action={generateStudyAction} /> : null}</div> : null}
    {state === "generating" ? <div className="mt-4 space-y-3"><PollRefresh intervalMs={3000} /><span className={CHIP_BLUSH}>Building</span><p className={MUTED}>Your study guide is being built from your scored sessions.</p></div> : null}
    {state === "failed" ? <div className="mt-4 space-y-4"><p className="text-fine text-alarm">The study guide did not finish. Your sessions and any earlier guide are safe.</p><GenerateStudyButton packageId={active.id} label="Try again" className={SECONDARY_BUTTON} action={generateStudyAction} /></div> : null}
    {state === "stale" && study?.generated_at ? <div className={`${NOTICE} mt-4 space-y-3`}><p>{staleLine(study.generated_at, count)}</p><GenerateStudyButton packageId={active.id} label="Rebuild with the new sessions" className={SECONDARY_BUTTON} action={generateStudyAction} /></div> : null}
    {doc && study?.generated_at ? <StudyGuideView packageId={active.id} doc={doc} generatedAt={study.generated_at} bookmarks={bookmarks} showExports={state === "fresh" || state === "stale"} /> : <SavedOnly bookmarks={bookmarks} />}
  </Shell>;
}
