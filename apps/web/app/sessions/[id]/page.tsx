import { createClient } from "@supabase/supabase-js";
import Link from "next/link";

import PollRefresh from "@/components/PollRefresh";
import {
  ReportDeliveryMetrics,
  ReportDimensionCards,
  ReportObservations,
  ReportOutcomes,
  dimensionMetaFromRubric,
} from "@/components/ReportView";
import Shell from "@/components/Shell";
import TranscriptView from "@/components/TranscriptView";
import { formatSessionDate, nextSessionNumber } from "@/lib/home";
import {
  formatDelta,
  scoringStageCopy,
  VERDICT_LABELS,
  verdictClasses,
} from "@/lib/report-format";
import {
  deriveSessionDetailState,
  detailCta,
  detailCtaHref,
  dimensionScoreMap,
  previousScoredEntry,
  type SessionDetailState,
} from "@/lib/transcript";
import type { Rubric, SessionReport, TranscriptSegment } from "@/lib/types";
import { PRIMARY_BUTTON } from "@/lib/ui";
import type { Viewer } from "@/lib/viewer";
import { getViewer } from "@/lib/viewer";
import type { SessionProgressEntry } from "@/lib/worker";
import {
  authorizeViewerSession,
  getPackageByToken,
  getPackageProgress,
  getSessionTranscript,
} from "@/lib/worker";

export const dynamic = "force-dynamic";

// S8 — the session detail page: the product's core artifact. One session,
// told honestly: what the verdict was and where it is heading (trajectory),
// why (dimension cards with deltas), how it sounded (delivery metrics and
// observations), what was actually said (transcript synced to the recording),
// and what to do next (drills + one primary action).

// How long the replay URL stays valid — mirrors /api/recordings/download.
const AUDIO_TTL_SECONDS = 3600;

/**
 * Mints a signed download URL for the session recording at render time.
 * Best-effort: a missing recording or a storage hiccup hides the player
 * instead of failing the page — the report is the artifact, the replay is
 * the proof.
 */
async function mintAudioUrl(audioPath: string | null): Promise<string | null> {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!audioPath || !url || !serviceRoleKey) {
    return null;
  }
  try {
    const supabase = createClient(url, serviceRoleKey);
    const { data, error } = await supabase.storage
      .from("recordings")
      .createSignedUrl(audioPath, AUDIO_TTL_SECONDS);
    if (error || !data) {
      console.error("sessions/[id]: createSignedUrl failed", error);
      return null;
    }
    return data.signedUrl;
  } catch (err) {
    console.error("sessions/[id]: createSignedUrl threw", err);
    return null;
  }
}

function SignedOut({ sessionId }: { sessionId: string }) {
  return (
    <Shell viewer={null}>
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-balance">
          You need to sign in to see this session.
        </h1>
        <Link
          href={`/login?next=${encodeURIComponent(`/sessions/${sessionId}`)}`}
          className={PRIMARY_BUTTON}
        >
          Sign in
        </Link>
      </div>
    </Shell>
  );
}

// Foreign-owned and nonexistent sessions get the SAME page: a session id is
// not a capability, so the response must not reveal whether it exists.
function NotFound({ viewer }: { viewer: Viewer }) {
  return (
    <Shell viewer={viewer}>
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-balance">
          Session not found
        </h1>
        <p className="max-w-md text-sm text-neutral-600 dark:text-neutral-400">
          This link doesn&apos;t match any session on your account. Check the
          address, or head back to your sessions.
        </p>
        <Link href="/sessions" className={PRIMARY_BUTTON}>
          Back to your sessions
        </Link>
      </div>
    </Shell>
  );
}

function Unreachable({ viewer }: { viewer: Viewer }) {
  return (
    <Shell viewer={viewer}>
      <PollRefresh intervalMs={5000} />
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-balance">
          Can&apos;t reach this session right now.
        </h1>
        <p className="max-w-md text-sm text-neutral-600 dark:text-neutral-400">
          Your account is fine — the service that holds your sessions is briefly
          unreachable, most often during a restart. This page retries by itself;
          leave it open.
        </p>
      </div>
    </Shell>
  );
}

function ContextLine({
  roleTitle,
  index,
  total,
  date,
}: {
  roleTitle: string | null;
  index: number;
  total: number;
  date: string | null;
}) {
  return (
    <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
      {roleTitle ?? "Your interview package"} · Session {index} of {total}
      {date ? ` · ${date}` : ""}
    </p>
  );
}

function CtaBlock({ href, label }: { href: string; label: string }) {
  return (
    <div className="border-t border-neutral-200 pt-8 dark:border-neutral-800">
      <Link href={href} className={`${PRIMARY_BUTTON} inline-block`}>
        {label}
      </Link>
    </div>
  );
}

// The trajectory header: the verdict, the number, and — when a previous
// scored session exists — how far this one moved against it.
function TrajectoryHeader({
  report,
  state,
  previous,
  progressLoaded,
}: {
  report: SessionReport;
  state: "scored" | "limited";
  previous: SessionProgressEntry | null;
  progressLoaded: boolean;
}) {
  const delta =
    previous !== null && previous.overall !== null
      ? report.overall_score - previous.overall
      : null;
  return (
    <section className={`rounded-lg border p-6 ${verdictClasses(report.verdict)}`}>
      <p className="text-sm uppercase tracking-wide">Verdict</p>
      <p className="text-3xl font-bold">
        {VERDICT_LABELS[report.verdict]}
        <span className="ml-3 text-xl font-medium">
          {report.overall_score.toFixed(2)} / 5
        </span>
      </p>
      {/* F-03 headline; reports stored before the field carry "". */}
      {report.headline ? <p className="mt-2 text-base">{report.headline}</p> : null}
      {delta !== null && previous !== null ? (
        <p className="mt-2 text-sm">
          <span className="font-semibold tabular-nums">{formatDelta(delta)}</span>{" "}
          overall vs session {previous.index}, your previous scored session.
        </p>
      ) : progressLoaded && previous === null ? (
        <p className="mt-2 text-sm">
          Your first scored session — the baseline the next ones move against.
        </p>
      ) : null}
      {/* In the limited state the banner above carries the limits note. */}
      {state === "scored" ? (
        <p className="mt-3 text-sm">{report.limits_note}</p>
      ) : null}
    </section>
  );
}

function audioCaption(state: SessionDetailState): string {
  switch (state) {
    case "scored":
    case "limited":
      return "Your recording. This is what was scored — nothing else.";
    case "scoring":
      return "Your recording. Scoring runs against this exact audio.";
    default:
      return "Your recording from this session.";
  }
}

export default async function SessionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const viewer = await getViewer();
  if (!viewer) {
    return <SignedOut sessionId={id} />;
  }

  const access = await authorizeViewerSession(viewer, id);
  if (!access.ok) {
    return access.status === 502 ? (
      <Unreachable viewer={viewer} />
    ) : (
      <NotFound viewer={viewer} />
    );
  }
  const { session, pkg } = access.value;

  const { ended } = await searchParams;
  const state = deriveSessionDetailState(session, ended);

  // A planned slot has nothing recorded, transcribed, or scored — skip the
  // fetches instead of asking three services for what cannot exist.
  const attempted = state !== "not_started" && state !== "guard_ended";

  let segments: TranscriptSegment[] | null = null;
  let transcriptFetchFailed = false;
  let entries: SessionProgressEntry[] | null = null;
  let audioUrl: string | null = null;
  let rubric: Rubric | null = null;
  if (attempted) {
    const [transcriptResult, progressResult, mintedUrl, fullPackage] =
      await Promise.all([
        getSessionTranscript(id).then(
          (value) => ({ ok: true as const, value }),
          () => ({ ok: false as const }),
        ),
        getPackageProgress(pkg.id).then(
          (value) => ({ ok: true as const, value }),
          () => ({ ok: false as const }),
        ),
        mintAudioUrl(session.audio_path),
        // The summary carries no rubric; the dimension cards need it for
        // names and channels. A failure degrades the cards to raw keys.
        session.report === null
          ? Promise.resolve(null)
          : getPackageByToken(pkg.access_token).catch(() => null),
      ]);
    if (transcriptResult.ok) {
      segments = transcriptResult.value;
    } else {
      transcriptFetchFailed = true;
    }
    if (progressResult.ok) {
      entries = progressResult.value.sessions;
    }
    audioUrl = mintedUrl;
    rubric = fullPackage?.rubric ?? null;
  }

  // Without the progress feed there is no honest "next session" to promise —
  // the CTA degrades to home rather than guessing a number.
  const nextNumber =
    entries === null ? null : nextSessionNumber(entries, pkg.total_sessions);
  const cta = detailCta(state, session.id, nextNumber);
  const ctaHref = detailCtaHref(cta, entries ?? []);
  const previous =
    entries === null ? null : previousScoredEntry(entries, session.index);
  const date = formatSessionDate(session.created_at);

  const transcriptSection = (
    <TranscriptView
      segments={segments}
      observations={session.report?.delivery_observations ?? []}
      audioUrl={audioUrl}
      audioCaption={audioCaption(state)}
      unavailableNote={
        transcriptFetchFailed
          ? "Couldn't load the transcript right now — reload to try again."
          : "Transcript unavailable for this session."
      }
    />
  );

  // --- Report states: the full anatomy -----------------------------------
  if ((state === "scored" || state === "limited") && session.report) {
    const report = session.report;
    const dimensions = rubric ? dimensionMetaFromRubric(rubric) : [];
    return (
      <Shell viewer={viewer}>
        <div className="flex flex-col gap-10">
          <header className="flex flex-col gap-4">
            <ContextLine
              roleTitle={pkg.role_title}
              index={session.index}
              total={pkg.total_sessions}
              date={date}
            />
            {state === "limited" ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                <p className="font-semibold">Scored on limited evidence</p>
                <p className="mt-1">{report.limits_note}</p>
              </div>
            ) : null}
            <TrajectoryHeader
              report={report}
              state={state}
              previous={previous}
              progressLoaded={entries !== null}
            />
          </header>

          <ReportDimensionCards
            report={report}
            dimensions={dimensions}
            previous={previous === null ? undefined : dimensionScoreMap(previous)}
          />
          <ReportDeliveryMetrics metrics={report.delivery_metrics} />
          <ReportObservations observations={report.delivery_observations} />
          {transcriptSection}
          <ReportOutcomes report={report} />
          <CtaBlock href={ctaHref} label={cta.label} />
        </div>
      </Shell>
    );
  }

  // --- Non-report states ---------------------------------------------------
  const heading: Record<Exclude<SessionDetailState, "scored" | "limited">, string> = {
    insufficient: "Not scored — not enough evidence.",
    guard_ended: "This session ended early.",
    not_started: "Not started — slot preserved.",
    scoring: "Scoring your session…",
    failed: "Scoring failed",
  };
  const body: Record<Exclude<SessionDetailState, "scored" | "limited">, string> = {
    insufficient:
      "This session ended before there was enough to score fairly. Numbers from partial evidence would be a guess, so there are none. The slot is preserved — run the session again when you're ready.",
    guard_ended:
      "The session guard stopped this one before it could count. Nothing was scored and the slot is preserved — start again whenever you're ready.",
    not_started:
      "This session hasn't happened yet. Its slot is waiting for you.",
    scoring:
      "Transcription, delivery metrics, and dual-channel judging usually take a few minutes. This page refreshes itself.",
    failed:
      "We could not score this session — most often an unreadable recording. We show failures instead of papering over them. The slot is preserved; run it again whenever you're ready.",
  };
  const narrowState = state as Exclude<SessionDetailState, "scored" | "limited">;
  const stage = state === "scoring" ? scoringStageCopy(session.scoring_stage) : null;
  // Terminal attempted states always render the transcript section (its own
  // quiet note covers a missing transcript); mid-scoring it appears the
  // moment the transcribe stage saves it.
  const showTranscript =
    state === "insufficient" ||
    state === "failed" ||
    (state === "scoring" && segments !== null);

  return (
    <Shell viewer={viewer}>
      {state === "scoring" ? <PollRefresh intervalMs={3000} /> : null}
      <div className="flex flex-col gap-10">
        <header className="flex flex-col gap-3">
          <ContextLine
            roleTitle={pkg.role_title}
            index={session.index}
            total={pkg.total_sessions}
            date={date}
          />
          <h1 className="text-2xl font-bold tracking-tight text-balance">
            {heading[narrowState]}
          </h1>
          <p className="max-w-prose text-sm text-neutral-600 dark:text-neutral-400">
            {stage ?? body[narrowState]}
          </p>
        </header>
        {showTranscript ? transcriptSection : null}
        <CtaBlock href={ctaHref} label={cta.label} />
      </div>
    </Shell>
  );
}
