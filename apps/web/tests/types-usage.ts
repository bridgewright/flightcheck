// Compile-time contract check for lib/types.ts. Never executed at runtime:
// `npm run typecheck` fails if any key drifts from the worker's JSON shapes
// (snake_case, exactly as serialized by services/scorer pydantic models).
import type {
  CreatePackageBody,
  CreateSessionResponse,
  PackageRow,
  Rubric,
  SessionPlan,
  SessionReport,
  SessionRow,
  TranscriptSegment,
} from "@/lib/types";

const rubric: Rubric = {
  role_title: "Senior Product Analyst",
  company: "ExampleCorp",
  dimensions: [
    {
      key: "structured-communication",
      name: "Structured communication",
      weight: 0.5,
      channel: "content",
      anchors: [
        { score: 1, behavior: "Answers wander without a discernible structure." },
        { score: 3, behavior: "States a conclusion, then supports it unevenly." },
        { score: 5, behavior: "Leads with the answer, supports it with ordered evidence." },
      ],
      signals: ["answer-first framing", "signposted transitions"],
      citations: [
        {
          url: "https://example.com/interview-guide",
          title: "Example interview guide",
          snippet: "Candidates are expected to lead with a recommendation.",
        },
      ],
    },
    {
      key: "delivery-composure",
      name: "Composure under pressure",
      weight: 0.5,
      channel: "delivery",
      anchors: [
        { score: 1, behavior: "Long silences and trailing-off after challenges." },
        { score: 3, behavior: "Recovers after challenges with brief hesitation." },
        { score: 5, behavior: "Steady pace and tone through challenges." },
      ],
      signals: ["response latency after probes"],
      citations: [
        {
          url: "https://example.com/candidate-reports",
          title: "Candidate-reported interview experiences",
          snippet: "Interviewers push back on one answer to test composure.",
        },
      ],
    },
  ],
  question_bank: [
    {
      dimension_key: "structured-communication",
      question: "Walk me through a recent analysis you drove end to end.",
      probes: ["What exactly was your recommendation?", "What number backed it?"],
      source: "research-sweep",
    },
  ],
  research_summary: "Interviewers reward answer-first structure and probe for specifics.",
};

const plan: SessionPlan = {
  session_index: 1,
  focus: "baseline",
  question_sequence: rubric.question_bank,
  pressure_probe: {
    dimension_key: "delivery-composure",
    question: "I don't think that metric proves impact. Why is it the right one?",
    probes: ["What would change your mind?"],
    source: "generated",
  },
  time_budget_minutes: 20,
};

const report: SessionReport = {
  session_id: "sess-check",
  verdict: "approaching",
  headline: "Approaching: structure is there, composure under pressure is not.",
  eligibility: "scored",
  overall_score: 3.4,
  dimension_scores: [
    {
      dimension_key: "structured-communication",
      score: 3.5,
      evidence_quotes: ["My recommendation was to cut the experiment early."],
      rationale: "Leads with a conclusion in two of three answers.",
      strengths: ["Leads with the recommendation before the evidence."],
      weaknesses: ["Supporting evidence arrives unevenly after the claim."],
    },
  ],
  delivery_metrics: {
    wpm_overall: 128.4,
    wpm_timeline: [121.0, 133.5, 130.2],
    silence_events: [{ start_s: 251.2, duration_s: 2.8 }],
    filler_count: 21,
    filler_rate_per_min: 1.6,
    f0_variance: 412.7,
    avg_response_latency_s: 1.4,
  },
  delivery_observations: [
    {
      at_s: 252.0,
      kind: "trailing-off",
      note: "Sentence volume drops and the clause is left unfinished at 04:12.",
      conflicts_with_dsp: false,
    },
  ],
  strengths: ["Structured communication (3.5/5): leads with the recommendation."],
  gaps: ["Composure under pressure (3.0/5): score-5 anchor expects steady pace through challenges."],
  next_drills: ["Composure under pressure: rehearse the pressure probe with a 2-second pause budget."],
  limits_note:
    "This verdict reflects alignment with rubric anchors and an experienced-interviewer scoring protocol; it is not a prediction of any specific company's decision.",
};

const pkg: PackageRow = {
  id: "pkg-check",
  access_token: "tok-check",
  status: "ready",
  user_id: "user-check",
  total_sessions: 6,
  jd_text: "We are hiring a Senior Product Analyst.",
  candidate_profile: {
    name: "Alex Example",
    headline: "Senior Product Analyst",
    years_experience: "4+ years",
    roles: ["Senior Product Analyst, ExampleCorp"],
    skills: ["SQL", "Python"],
    achievements: ["Cut dashboard load time 40%"],
  },
  rubric,
};

const session: SessionRow = {
  id: "sess-check",
  package_id: "pkg-check",
  index: 1,
  status: "scored",
  scoring_stage: null,
  session_plan: plan,
  audio_path: "packages/pkg-check/session-1.webm",
  report,
  created_at: "2026-08-01T09:00:00Z",
};

const transcript: TranscriptSegment[] = [
  { start_s: 0.0, end_s: 4.2, speaker: "interviewer", text: "Walk me through it." },
  { start_s: 4.6, end_s: 21.9, speaker: "candidate", text: "Uh, my recommendation was..." },
];

const createBody: CreatePackageBody = {
  jd_text: "We are hiring a Senior Product Analyst.",
  resume_pdf_b64: "JVBERi0xLjQ=",
  user_id: "user-check",
};

const createSessionResponse: CreateSessionResponse = {
  session_id: "sess-check",
  session_plan: plan,
  interviewer_instructions: "You are Morgan, a senior hiring manager.",
};

export const __checked = [
  rubric,
  plan,
  report,
  pkg,
  session,
  transcript,
  createBody,
  createSessionResponse,
] as const;
