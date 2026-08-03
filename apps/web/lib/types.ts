// TS mirrors of the worker's pydantic models (services/scorer/src/scorer/schemas.py)
// and API rows (scorer/api/db.py). snake_case keys are preserved exactly as the
// worker serializes them -- no camelCase conversion in v0.1.

export interface SourceCitation {
  url: string;
  title: string;
  snippet: string;
}

export interface CandidateProfile {
  name: string | null;
  headline: string | null;
  years_experience: string | null;
  roles: string[];
  skills: string[];
  achievements: string[];
}

export interface BarsAnchor {
  score: number;
  behavior: string;
}

export type Channel = "content" | "delivery";

export interface RubricDimension {
  key: string;
  name: string;
  weight: number;
  channel: Channel;
  anchors: BarsAnchor[];
  signals: string[];
  citations: SourceCitation[];
}

export type QuestionSource = "research-sweep" | "corpus" | "generated";

export interface QuestionSpec {
  dimension_key: string;
  question: string;
  probes: string[];
  source: QuestionSource;
}

export interface Rubric {
  role_title: string;
  company: string | null;
  dimensions: RubricDimension[];
  question_bank: QuestionSpec[];
  research_summary: string;
}

export interface SessionPlan {
  session_index: number;
  focus: "baseline";
  question_sequence: QuestionSpec[];
  pressure_probe: QuestionSpec;
  time_budget_minutes: number;
}

export interface SilenceEvent {
  start_s: number;
  duration_s: number;
}

export interface DeliveryMetrics {
  wpm_overall: number;
  wpm_timeline: number[];
  silence_events: SilenceEvent[];
  filler_count: number;
  filler_rate_per_min: number;
  f0_variance: number | null;
  avg_response_latency_s: number | null;
}

export interface TimestampedObservation {
  at_s: number;
  kind: string;
  note: string;
  conflicts_with_dsp: boolean;
}

export interface DimensionScore {
  dimension_key: string;
  score: number;
  evidence_quotes: string[];
  rationale: string;
  // F-03: what worked / what held the score down, per dimension. The worker
  // serializes defaults ([]) for reports stored before the fields existed.
  strengths: string[];
  weaknesses: string[];
}

export type Verdict = "not_ready" | "approaching" | "ready";

// F-04: how much evidence backed the numbers. "limited" = 10-15 min session;
// below the floor no report exists at all (session status "insufficient").
export type ReportEligibility = "scored" | "limited";

export interface SessionReport {
  session_id: string;
  verdict: Verdict;
  // F-03: one-sentence takeaway, <= 120 chars; "" on reports stored before
  // the field existed (renderers fall back to the verdict phrase).
  headline: string;
  eligibility: ReportEligibility;
  overall_score: number;
  dimension_scores: DimensionScore[];
  delivery_metrics: DeliveryMetrics;
  delivery_observations: TimestampedObservation[];
  strengths: string[];
  gaps: string[];
  next_drills: string[];
  limits_note: string;
}

export type PackageStatus = "compiling" | "ready" | "failed";

export interface PackageRow {
  id: string;
  access_token: string;
  status: PackageStatus;
  // The owning account; null while the package is unclaimed (the first
  // authenticated visitor binds it).
  user_id: string | null;
  // How many sessions the package owes (`not null default 6` in the DB).
  total_sessions: number;
  jd_text: string;
  candidate_profile: CandidateProfile | null;
  rubric: Rubric | null;
  // v0.5 payments fields (migration 005). Optional because rows serialized
  // by a pre-v0.5 worker omit them; render helpers must treat absence like
  // the defaults (not trial, unpaid). is_trial marks the first package per
  // account and stays true after payment — paid state is `paid_at != null`;
  // expires_at = paid_at + 30 days; order_id links the provisioning order.
  is_trial?: boolean;
  paid_at?: string | null;
  expires_at?: string | null;
  order_id?: string | null;
}

// Mirror of scorer.api.db.OrderRow: one Polar order, as the worker's
// GET /api/orders?user_id= serializes it. polar_order_id is the webhook's
// idempotency key (UNIQUE in the DB).
export interface OrderRow {
  id: string;
  user_id: string;
  package_id: string;
  polar_order_id: string;
  polar_checkout_id: string | null;
  amount_minor: number | null; // e.g. 4900 for $49.00
  currency: string | null;
  status: string | null;
  created_at: string | null;
}

// "insufficient" (F-04) is terminal like "failed" and just as retriable:
// the session ended below the evidence floor, no report exists, and the
// slot is preserved for another attempt.
export type SessionStatus =
  | "planned"
  | "scoring"
  | "scored"
  | "failed"
  | "insufficient"
  // Retired by the worker after the resume/re-score caps (v0.5 guards): the
  // attempt happened and the slot is spent, but no report will ever exist.
  | "failed_permanent";

export interface SessionRow {
  id: string;
  package_id: string;
  index: number;
  status: SessionStatus;
  scoring_stage: string | null; // coarse worker progress while "scoring"
  session_plan: SessionPlan | null;
  audio_path: string | null;
  report: SessionReport | null;
  // Rows created before the column existed omit it; render without a date
  // rather than inventing one.
  created_at?: string | null;
  // v0.5 (migration 005): worker-side reaper timestamp and realtime-secret
  // mint counter. Serialized by the v0.5 worker (row model_dump); optional
  // because older serializations omit them.
  updated_at?: string | null;
  secret_mints?: number;
  // v0.6 (migration 006): capability-token lifetime for the package
  // access_token that unlocks the room. Null expiry means "no expiry" (the
  // pre-006 behaviour) and null revocation means "never revoked". The worker
  // serializes both as null until F-12 starts populating them.
  access_token_expires_at?: string | null;
  token_revoked_at?: string | null;
}

// One turn of the verbatim session transcript (scorer schemas.TranscriptSegment),
// saved by the worker right after the transcribe stage — failed sessions keep
// their transcripts too. Text is verbatim: fillers and repeats preserved.
export interface TranscriptSegment {
  start_s: number;
  end_s: number;
  speaker: "interviewer" | "candidate";
  text: string;
}

// --- v0.6 ---------------------------------------------------------------


// Mirror of the worker's GET /api/metrics/usage (F-13): the operator's
// answer to "how many sessions completed, how fast, how much of the package
// got used", aggregated from existing columns.
//
// sample_size is not decoration. Impression rule ⑦ turns on saying plainly
// how many real sessions a number came from, and every consumer of this
// shape has to be able to. Rates are 0-1; a p50 is null until there is
// anything to take a median of.
export interface UsageMetrics {
  sample_size: number;
  session_completion_rate: number;
  p50_first_response_s: number | null;
  p50_scoring_latency_s: number | null;
  package_burn_through: number;
}

export interface CreatePackageBody {
  jd_text?: string;
  jd_url?: string;
  resume_text?: string;
  resume_pdf_b64?: string;
  linkedin_text?: string;
  linkedin_pdf_b64?: string;
  // Packages are born bound: /new is auth-gated, so the creating account's
  // id rides along and the package never goes through an unclaimed phase.
  user_id?: string;
}

export interface CreateSessionResponse {
  session_id: string;
  session_plan: SessionPlan;
  interviewer_instructions: string;
}
