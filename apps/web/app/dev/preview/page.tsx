import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { loadSampleReport } from "@/app/sample-report/sample-data";
import JourneyStrip from "@/components/JourneyStrip";
import ReadinessGauge from "@/components/ReadinessGauge";
import ReportView from "@/components/ReportView";
import SessionList from "@/components/SessionList";
import SessionTicket from "@/components/SessionTicket";
import TranscriptView from "@/components/TranscriptView";
import {
  journeyLegs,
  nextSessionNumber,
  scoringStageLine,
  verdictLine,
} from "@/lib/home";
import type { TimestampedObservation, TranscriptSegment } from "@/lib/types";
import { PRIMARY_BUTTON } from "@/lib/ui";
import type { SessionSummary } from "@/lib/worker";
import sampleJson from "@/public/sample-report.json";

// Dev-only component preview from checked-in fixtures. Both prior design
// sessions had to build throwaway routes to see the dashboard and report
// components without a live worker and a real scored session; this page is
// that surface, kept. Everything below is static fixture data — no fetches,
// no account, no worker.

// The report fixture is the real anonymized session behind /sample-report,
// loaded through the same validating loader so the two pages cannot diverge.
const sample = loadSampleReport(sampleJson);

const TOTAL_SESSIONS = 6;

// A package mid-journey with every session status on display: two scored
// (session 02's report is the sample report), a scoring failure, an
// insufficient-evidence ending, and one still being scored. Failed and
// insufficient rows keep their slots, so the next session resumes slot 03.
const SESSIONS: SessionSummary[] = [
  {
    id: "fixture-session-01",
    index: 1,
    status: "scored",
    report_available: true,
    overall: 3.1,
    verdict: "not_ready",
    scoring_stage: null,
    created_at: "2026-07-27T09:40:00Z",
  },
  {
    id: "fixture-session-02",
    index: 2,
    status: "scored",
    report_available: true,
    overall: sample.report.overall_score,
    verdict: sample.report.verdict,
    scoring_stage: null,
    created_at: "2026-07-29T21:05:00Z",
  },
  {
    id: "fixture-session-03",
    index: 3,
    status: "failed",
    report_available: false,
    overall: null,
    verdict: null,
    scoring_stage: null,
    created_at: "2026-07-31T08:15:00Z",
  },
  {
    id: "fixture-session-04",
    index: 4,
    status: "insufficient",
    report_available: false,
    overall: null,
    verdict: null,
    scoring_stage: null,
    created_at: "2026-08-01T12:30:00Z",
  },
  {
    id: "fixture-session-05",
    index: 5,
    status: "scoring",
    report_available: false,
    overall: null,
    verdict: null,
    scoring_stage: "content-judge",
    created_at: "2026-08-02T19:20:00Z",
  },
];

// A short stretch of a session in the sample report's world: mapping a
// customer-service process before proposing an LLM call-quality evaluator.
// Verbatim register — fillers and repeats preserved, as the worker stores it.
const seg = (
  start_s: number,
  end_s: number,
  speaker: "interviewer" | "candidate",
  text: string,
): TranscriptSegment => ({ start_s, end_s, speaker, text });

const TRANSCRIPT: TranscriptSegment[] = [
  seg(
    0,
    9,
    "interviewer",
    "Thanks for joining. Let's start concretely: your customer's support team is drowning in call volume and leadership wants AI in the loop. Where do you begin?",
  ),
  seg(
    14,
    52,
    "candidate",
    "Uh, first of all, I think I'll I'll do interview with our customer, because, uh, the most important thing is to map the whole customer service process (who do what, and when) before we talk about any model at all.",
  ),
  seg(
    55,
    63,
    "interviewer",
    "Okay. And once you have that map, how do you decide where a model actually helps?",
  ),
  seg(
    66,
    118,
    "candidate",
    "So, after defining the whole process, uh, the next step is to define which data is stored in what system, and how they accumulate those kind of, uh, data. Then we look for the step where a human is reading, uh, reading transcripts one by one. That is where an LLM can evaluate the call quality at scale.",
  ),
  seg(
    121,
    130,
    "interviewer",
    "You said evaluate call quality. How would you know the model's judgment is any good?",
  ),
  seg(
    133,
    189,
    "candidate",
    "Um, we used a subsidiary indicator (the score that the LLM model actually made based on the transcripts) and we, uh, we compared it against the QA team's own sampled reviews. When the two disagreed we read those calls together with the customer, and that was, uh, that was how we calibrated it.",
  ),
  seg(
    192,
    200,
    "interviewer",
    "Good. Last one: what did that project cost you personally, and what would you do differently?",
  ),
  seg(
    203,
    246,
    "candidate",
    "Honestly, uh, I underestimated the rollout part. The model was ready weeks before the team actually trusted it, so, uh, if I do it again I will bring the QA leads in from the first week, not after the pilot.",
  ),
];

const OBSERVATIONS: TimestampedObservation[] = [
  {
    at_s: 24.6,
    kind: "filler",
    note: "Frequent 'uh' fillers while the first answer finds its structure.",
    conflicts_with_dsp: false,
  },
  {
    at_s: 140.2,
    kind: "pace",
    note: "Delivery sounds hurried while describing the evaluation loop.",
    conflicts_with_dsp: true,
  },
];

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-5 border-t border-hairline pt-8">
      <header>
        <h2 className="font-mono text-sm font-semibold">{title}</h2>
        <p className="mt-1 text-xs text-ink-faint">{note}</p>
      </header>
      {children}
    </section>
  );
}

// Request-time rendering so the production guard returns a real 404 status —
// statically prerendered, the notFound() shell was served with HTTP 200.
export const dynamic = "force-dynamic";

export default function DevPreviewPage() {
  // Fixtures are not product surface: in production this route does not exist.
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const legs = journeyLegs(SESSIONS, TOTAL_SESSIONS);
  const next = nextSessionNumber(SESSIONS, TOTAL_SESSIONS);
  const stageLine = scoringStageLine(SESSIONS);
  const dimensionNames = Object.fromEntries(
    sample.dimensions.map((dimension) => [dimension.key, dimension.name]),
  );
  const line = verdictLine(sample.report, dimensionNames);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-10">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Component preview</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Dev-only. Dashboard and report components rendered from checked-in
          fixtures: no worker, no account, no live session. This route 404s in
          production.
        </p>
      </header>

      <Section
        title="JourneyStrip"
        note="Five of six slots touched; the failed slot 03 is where the user resumes."
      >
        <JourneyStrip legs={legs} />
      </Section>

      <Section
        title="SessionTicket"
        note="Resuming slot 03 while session 05 is being scored; verdict line from the sample report."
      >
        <SessionTicket
          sessionNumber={next}
          totalSessions={TOTAL_SESSIONS}
          verdict={line}
          stageLine={stageLine}
          action={
            // Inert stand-in for StartSessionButton: same look, no POST.
            <span className={PRIMARY_BUTTON}>Start session {next}</span>
          }
        />
      </Section>

      <Section
        title="ReadinessGauge"
        note="Latest scored session's overall and verdict (sample report)."
      >
        <div className="max-w-[168px]">
          <ReadinessGauge
            score={sample.report.overall_score}
            verdict={sample.report.verdict}
          />
        </div>
      </Section>

      <Section
        title="SessionList"
        note="One row per status: scored (x2), failed, insufficient, scoring. Row links lead to real routes and will not resolve for fixture ids."
      >
        <SessionList sessions={SESSIONS} />
      </Section>

      <Section
        title="ReportView"
        note="The full report block from public/sample-report.json, via the same validating loader as /sample-report."
      >
        <ReportView report={sample.report} dimensions={sample.dimensions} />
      </Section>

      <Section
        title="TranscriptView"
        note="Eight verbatim turns with two delivery observations inlined (one DSP conflict). No fixture audio, so timestamps render as plain text and the player is absent."
      >
        <TranscriptView
          segments={TRANSCRIPT}
          observations={OBSERVATIONS}
          audioUrl={null}
          audioCaption="Your recording. This is what was scored. Nothing else."
        />
      </Section>
    </main>
  );
}
