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
}

export type Verdict = "not_ready" | "approaching" | "ready";

export interface SessionReport {
  session_id: string;
  verdict: Verdict;
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
  jd_text: string;
  candidate_profile: CandidateProfile | null;
  rubric: Rubric | null;
}

export type SessionStatus = "planned" | "scoring" | "scored" | "failed";

export interface SessionRow {
  id: string;
  package_id: string;
  index: number;
  status: SessionStatus;
  session_plan: SessionPlan | null;
  audio_path: string | null;
  report: SessionReport | null;
}

export interface CreatePackageBody {
  jd_text?: string;
  jd_url?: string;
  resume_text?: string;
  resume_pdf_b64?: string;
  linkedin_text?: string;
  linkedin_pdf_b64?: string;
}

export interface CreateSessionResponse {
  session_id: string;
  session_plan: SessionPlan;
  interviewer_instructions: string;
}
