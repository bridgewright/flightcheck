import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import { redirect } from "next/navigation";

import PollRefresh from "@/components/PollRefresh";
import {
  type DimensionMeta,
  ReportDeliveryMetrics,
  ReportDimensionCards,
  ReportObservations,
  ReportOutcomes,
  ReportVerdict,
  dimensionMetaFromRubric,
} from "@/components/ReportView";
import Shell from "@/components/Shell";
import StartSessionButton from "@/components/StartSessionButton";
import TranscriptView from "@/components/TranscriptView";
import SessionStudyTab from "@/components/SessionStudyTab";
import { setParaphraseMarkAction } from "./actions";
import { formatSessionDate, nextSessionNumber } from "@/lib/home";
import {
  formatDelta,
  scoringStageCopy,
} from "@/lib/report-format";
import {
  deriveSessionDetailState,
  detailCta,
  detailCtaHref,
  dimensionScoreMap,
  previousScoredEntry,
  type SessionDetailState,
} from "@/lib/transcript";
import type { Rubric, SessionCoaching, SessionReport, TranscriptSegment } from "@/lib/types";
import { DIVIDER, LABEL, MUTED, PAGE_HEADING, PRIMARY_BUTTON, SECONDARY_BUTTON, SUB_HEADING, SUBTLE, TAB, TAB_ACTIVE } from "@/lib/ui";
import type { Viewer } from "@/lib/viewer";
import { getViewer } from "@/lib/viewer";
import type { SessionProgressEntry } from "@/lib/worker";
import {
  authorizeViewerSession,
  getPackageByToken,
  getPackageProgress,
  getSessionCoaching,
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
        <h1 className={`${PAGE_HEADING} text-balance`}>
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

// --- Icons (F-43) ---------------------------------------------------------
//
// Inline, no dependency, and deliberately drawn with stroke="currentColor"
// and no colour class of their own: they inherit whatever the surrounding
// text is, so the F-21 design pass re-points them by re-pointing type
// colour rather than by re-authoring this file. All decorative — the
// heading beside each one carries the meaning, so they are aria-hidden and
// a screen reader never announces them.

const ICON_PATHS = {
  // A clock: work is in progress and will finish on its own.
  clock: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z", "M12 7.5V12l3.5 2"],
  // A warning triangle: something broke and we are saying so.
  alert: ["M12 4 21 19.5H3L12 4Z", "M12 10v4", "M12 16.5v.01"],
  // A circle with a bar: attempted, but below the floor to score.
  short: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z", "M8 12h8"],
  // A circle with a slash: retired, the door is closed.
  closed: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z", "M6.5 6.5 17.5 17.5"],
  // A play outline: nothing has happened here yet, and it is yours to start.
  play: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z", "M10.5 8.5 16 12l-5.5 3.5V8.5Z"],
  // A magnifier: we looked and found nothing under this address.
  search: ["M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z", "m16 16 4 4"],
  // A crossed-out cloud: the service is briefly out of reach.
  offline: [
    "M7 18a4 4 0 0 1-.4-7.98A5.5 5.5 0 0 1 16.9 9.2 3.9 3.9 0 0 1 19 16.6",
    "M4 4 20 20",
  ],
  // An arrow: this takes you somewhere.
  arrow: ["M4.5 12h14", "m13.5 7 5 5-5 5"],
} as const;

function Icon({
  name,
  className = "size-5",
}: {
  name: keyof typeof ICON_PATHS;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
    >
      {ICON_PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

// Which glyph belongs to each state the page can render without a report.
const STATE_ICONS: Record<
  Exclude<SessionDetailState, "scored" | "limited">,
  keyof typeof ICON_PATHS
> = {
  insufficient: "short",
  not_started: "play",
  scoring: "clock",
  failed: "alert",
  closed: "closed",
};

// Foreign-owned and nonexistent sessions get the SAME page: a session id is
// not a capability, so the response must not reveal whether it exists.
function NotFound({ viewer }: { viewer: Viewer }) {
  return (
    <Shell viewer={viewer}>
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <Icon name="search" className="size-8 text-ink-faint" />
        <h1 className={`${PAGE_HEADING} text-balance`}>
          Session not found
        </h1>
        <p className={`${SUBTLE} max-w-md`}>
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
        <Icon name="offline" className="size-8 text-ink-faint" />
        <h1 className={`${PAGE_HEADING} text-balance`}>
          Can&apos;t reach this session right now.
        </h1>
        <p className={`${SUBTLE} max-w-md`}>
          Your account is fine. The service that holds your sessions is briefly
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
    <p className={LABEL}>
      {roleTitle ?? "Your interview package"} · Session {index} of {total}
      {date ? ` · ${date}` : ""}
    </p>
  );
}

function CtaBlock({ href, label }: { href: string; label: string }) {
  return (
    <div className={`border-t pt-8 ${DIVIDER}`}>
      <Link href={href} className={`${PRIMARY_BUTTON} inline-flex items-center gap-2`}>
        {label}
        <Icon name="arrow" className="size-4" />
      </Link>
    </div>
  );
}

// Two links, not two buttons that fetch: `<a download>` lets the browser
// stream the file and keep the filename the route sets. A fetch-and-blob
// would buffer a whole report in the tab and lose both.
function DownloadControls({ sessionId }: { sessionId: string }) {
  return (
    <div className="flex flex-wrap gap-3">
      <a
        href={`/api/reports/${encodeURIComponent(sessionId)}?format=pdf`}
        download
        className={SECONDARY_BUTTON}
      >
        Download PDF
      </a>
      <a
        href={`/api/reports/${encodeURIComponent(sessionId)}?format=md`}
        download
        className={SECONDARY_BUTTON}
      >
        Download Markdown
      </a>
    </div>
  );
}

// The trajectory header: the verdict, the number, and — when a previous
// scored session exists — how far this one moved against it.
function TrajectoryHeader({
  report,
  dimensions,
  state,
  previous,
  progressLoaded,
}: {
  report: SessionReport;
  dimensions: DimensionMeta[];
  state: "scored" | "limited";
  previous: SessionProgressEntry | null;
  progressLoaded: boolean;
}) {
  const delta =
    previous !== null && previous.overall !== null
      ? report.overall_score - previous.overall
      : null;
  // The same block the sample report shows, from one component. This screen
  // used to draw its own coloured band, so the verdict-first typography and
  // the two-bar gauge landed on the page a stranger can browse and not on the
  // page a paying customer reads after their session.
  return (
    <ReportVerdict
      report={report}
      dimensions={dimensions}
      // In the limited state the banner above already carries the note.
      showLimitsNote={state === "scored"}
    >
      {delta !== null && previous !== null ? (
        <p className={`${MUTED} text-fine`}>
          <span className="tabular-nums">{formatDelta(delta)}</span> overall vs
          session {previous.index}, your previous scored session.
        </p>
      ) : progressLoaded && previous === null ? (
        <p className={`${MUTED} text-fine`}>
          Your first scored session: the baseline the next ones move against.
        </p>
      ) : null}
    </ReportVerdict>
  );
}

function audioCaption(state: SessionDetailState): string {
  switch (state) {
    case "scored":
    case "limited":
      return "Your recording. This is what was scored. Nothing else.";
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
  searchParams: Promise<{ tab?: string | string[] }>;
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
  if (session.status === "quick_done") {
    redirect(`/quick/report/${session.package_id}`);
  }

  const state = deriveSessionDetailState(session);

  // A planned slot has nothing recorded, transcribed, or scored — skip the
  // fetches instead of asking three services for what cannot exist.
  const attempted = state !== "not_started";
  // Coaching is generated off a saved report, so only the report states can
  // have any; it joins the same parallel wave rather than adding a round trip.
  const reported = state === "scored" || state === "limited";

  let segments: TranscriptSegment[] | null = null;
  let transcriptFetchFailed = false;
  let entries: SessionProgressEntry[] | null = null;
  let audioUrl: string | null = null;
  let rubric: Rubric | null = null;
  let coaching: SessionCoaching | null = null;
  if (attempted) {
    const [transcriptResult, progressResult, mintedUrl, fullPackage, coachingResult] =
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
        // Additive: a failure here leaves the page exactly as it renders
        // without coaching, never as an error.
        reported ? getSessionCoaching(id).catch(() => null) : Promise.resolve(null),
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
    coaching = coachingResult;
  }

  // Without the progress feed there is no honest "next session" to promise —
  // the CTA degrades to home rather than guessing a number.
  const nextNumber =
    entries === null ? null : nextSessionNumber(entries, pkg.total_sessions);
  const cta = detailCta(state, session.id, nextNumber, entries);
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
          ? "Couldn't load the transcript right now. Reload to try again."
          : "Transcript unavailable for this session."
      }
      coaching={coaching}
      marksAction={setParaphraseMarkAction.bind(null, id)}
    />
  );

  // --- Report states: the full anatomy -----------------------------------
  if ((state === "scored" || state === "limited") && session.report) {
    const report = session.report;
    const dimensions = rubric ? dimensionMetaFromRubric(rubric) : [];
    const requestedTab = (await searchParams).tab;
    const tab = requestedTab === "study" || requestedTab === "transcript" ? requestedTab : "report";
    const tabs = ["report", "transcript", "study"] as const;
    return (
      <Shell viewer={viewer}>
        <div className="flex flex-col gap-10">
          <header>
            <ContextLine
              roleTitle={pkg.role_title}
              index={session.index}
              total={pkg.total_sessions}
              date={date}
            />
          </header>
          <nav aria-label="Session detail" className="flex border-b border-hairline">
            {tabs.map((name) => <Link key={name} href={`/sessions/${session.id}?tab=${name}`} className={tab === name ? TAB_ACTIVE : TAB}>{name[0].toUpperCase() + name.slice(1)}</Link>)}
          </nav>
          {tab === "report" ? <>
            {state === "limited" ? (
              <div className="rounded-surface border border-hairline bg-blush p-3 text-fine text-ink">
                <p className={SUB_HEADING}>Scored on limited evidence</p>
                <p className="mt-1">{report.limits_note}</p>
              </div>
            ) : null}
            <TrajectoryHeader
              report={report}
              dimensions={dimensions}
              state={state}
              previous={previous}
              progressLoaded={entries !== null}
            />
            <DownloadControls sessionId={session.id} />
            <ReportDimensionCards report={report} dimensions={dimensions} previous={previous === null ? undefined : dimensionScoreMap(previous)} />
            <ReportDeliveryMetrics metrics={report.delivery_metrics} />
            <ReportObservations observations={report.delivery_observations} />
            <ReportOutcomes report={report} />
            <CtaBlock href={ctaHref} label={cta.label} />
          </> : tab === "transcript" ? transcriptSection
            : <SessionStudyTab sessionId={session.id} coaching={coaching} segments={segments ?? []} />}
        </div>
      </Shell>
    );
  }

  // --- Non-report states ---------------------------------------------------
  const heading: Record<Exclude<SessionDetailState, "scored" | "limited">, string> = {
    insufficient: "Not scored: not enough evidence.",
    not_started: "Not started, slot preserved.",
    scoring: "Scoring your session…",
    failed: "Scoring failed",
    closed: "Closed, not scored.",
  };
  const body: Record<Exclude<SessionDetailState, "scored" | "limited">, string> = {
    insufficient:
      "This session ended before there was enough to score fairly. Numbers from partial evidence would be a guess, so there are none. The slot is preserved; run the session again when you're ready.",
    not_started:
      "This session hasn't happened yet. Its slot is waiting for you.",
    scoring:
      "Transcription, delivery metrics, and dual-channel judging usually take a few minutes. This page refreshes itself.",
    failed:
      "We could not score this session, most often because the recording could not be read. We show failures instead of papering over them. The slot is preserved; run it again whenever you're ready.",
    closed:
      "This session was retried several times without producing a scoreable result, so it is closed and the slot is spent. Whatever was saved (transcript, recording) stays available below.",
  };
  const narrowState = state as Exclude<SessionDetailState, "scored" | "limited">;
  const stage = state === "scoring" ? scoringStageCopy(session.scoring_stage) : null;
  // Terminal attempted states always render the transcript section (its own
  // quiet note covers a missing transcript); mid-scoring it appears the
  // moment the transcribe stage saves it.
  const showTranscript =
    state === "insufficient" ||
    state === "failed" ||
    state === "closed" ||
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
          <h1 className={`${PAGE_HEADING} flex items-start gap-2.5 text-balance`}>
            <Icon name={STATE_ICONS[narrowState]} className="mt-1 size-6" />
            {heading[narrowState]}
          </h1>
          <p className={`${SUBTLE} max-w-prose`}>
            {stage ?? body[narrowState]}
          </p>
        </header>
        {showTranscript ? transcriptSection : null}
        {cta.kind === "resume" ? (
          // The rerun door is the resume ACTION, not a room link: the room
          // refuses a session past "planned" (F-66), and POST /api/sessions
          // is what re-arms this row before entering its room.
          <StartSessionButton packageId={pkg.id} label={cta.label} />
        ) : (
          <CtaBlock href={ctaHref} label={cta.label} />
        )}
      </div>
    </Shell>
  );
}
