"""Shared pydantic models and the GenAI client protocol for the v0.1 loop.

Every cross-module data shape lives here (Plan 2 interface registry). All
models forbid extra fields so a drifting producer fails loudly at the
boundary instead of silently dropping data. Rubric integrity (citations,
BARS anchors, weight discipline) is enforced here, once, at the type
boundary.
"""
from __future__ import annotations

from typing import Any, Literal, Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict, model_validator

_WEIGHT_SUM_TOLERANCE = 0.01
_ANCHOR_SCORES = [1, 3, 5]


class SourceCitation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str
    title: str
    snippet: str                      # <= 300 chars, verbatim from source


class CandidateProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None
    headline: str | None
    years_experience: str | None      # e.g. "4+ years"
    roles: list[str]                  # most recent first
    skills: list[str]
    achievements: list[str]           # quantified where possible


class ResearchFindings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    queries: list[str]                # queries actually run
    reported_questions: list[str]     # questions real candidates reported
    probe_areas: list[str]            # where interviewers dig deeper
    evaluation_signals: list[str]     # what interviewers reward/penalize
    citations: list[SourceCitation]


class BarsAnchor(BaseModel):
    model_config = ConfigDict(extra="forbid")

    score: int                        # exactly one each of 1, 3, 5 per dimension
    behavior: str                     # behavioral description, question-independent


class RubricDimension(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str                          # kebab-case, unique within rubric
    name: str
    weight: float                     # weights sum to 1.0 (+/- 0.01) across dimensions
    channel: Literal["content", "delivery"]
    anchors: list[BarsAnchor]         # exactly 3 (scores 1, 3, 5)
    signals: list[str]
    citations: list[SourceCitation]   # min length 1 -- enforced by Rubric validator
    license: Literal["jd", "profile"] = "jd"
    # F-62: the verbatim JD quote that licenses this dimension -- an exact
    # substring of the job description the compiler saw, enforced in the
    # compile path (never here: this model re-validates every stored rubric
    # on read, and every rubric stored before the field existed has None).
    # None on delivery-channel dimensions too: those are licensed by the
    # product, not the JD.
    jd_evidence: str | None = None


class QuestionSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dimension_key: str
    question: str
    probes: list[str]                 # follow-up probes forcing specifics
    source: Literal["research-sweep", "corpus", "generated"]


class Rubric(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role_title: str
    company: str | None
    dimensions: list[RubricDimension]  # compiler targets 5-8; >=1 delivery channel
    question_bank: list[QuestionSpec]
    research_summary: str

    @model_validator(mode="after")
    def _validate_integrity(self) -> Rubric:
        total = sum(dim.weight for dim in self.dimensions)
        if abs(total - 1.0) > _WEIGHT_SUM_TOLERANCE:
            raise ValueError(
                f"dimension weights must sum to 1.0 within "
                f"+/-{_WEIGHT_SUM_TOLERANCE}, got {total:.4f}")
        for dim in self.dimensions:
            if not dim.citations:
                raise ValueError(
                    f"dimension {dim.key!r} has no citations; every dimension "
                    "needs at least one source citation")
            if sorted(anchor.score for anchor in dim.anchors) != _ANCHOR_SCORES:
                raise ValueError(
                    f"dimension {dim.key!r} anchors must be exactly scores 1, 3, 5")
        if all(dim.channel != "delivery" for dim in self.dimensions):
            raise ValueError("rubric needs at least one delivery-channel dimension")
        return self


class SessionPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_index: int                # real one-based index within the package
    focus: Literal["baseline", "targeted"]
    question_sequence: list[QuestionSpec]  # covers every dimension at least shallowly
    pressure_probe: QuestionSpec      # exactly one challenge moment
    time_budget_minutes: int          # 20


class TranscriptSegment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start_s: float
    end_s: float
    speaker: Literal["interviewer", "candidate"]
    text: str                         # verbatim, fillers preserved ("uh", "um", repeats)


class ParaphraseItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    turn_index: int
    verdict: Literal["good", "improve"]
    source_quote: str
    suggestion: str
    why: str


class SessionParaphrases(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: int = 1
    generated_at: str
    turn_count: int
    items: list[ParaphraseItem]


class InsightExpression(BaseModel):
    model_config = ConfigDict(extra="forbid")
    turn_index: int
    said_verbatim: str
    better: str
    why: str


class InsightAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str
    model_answer: str
    based_on_quotes: list[str]


class SessionInsights(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: int = 1
    generated_at: str
    did_well: list[str]
    did_poorly: list[str]
    must_keep: list[InsightExpression]
    must_answer: list[InsightAnswer]


class ParaphraseFlag(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: Literal["misheard", "inappropriate", "inaccurate", "missing", "other"]
    note: str

    @model_validator(mode="after")
    def validate_note(self):
        if len(self.note) > 500:
            raise ValueError("flag note must be at most 500 characters")
        if self.reason == "other" and not self.note.strip():
            raise ValueError("flag note is required for other")
        return self


class ParaphraseMark(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reaction: Literal["up", "down"] | None = None
    bookmarked: bool = False
    flag: ParaphraseFlag | None = None


class ParaphraseMarks(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: int = 1
    marks: dict[str, ParaphraseMark] = {}


class StudyProblem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str
    description: str
    dimension_keys: list[str]


class StudySummary(BaseModel):
    model_config = ConfigDict(extra="forbid")
    core_problems: list[StudyProblem]
    improvement_strategy: list[str]
    priority_expressions: list[str]


class StudyAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str
    dimension_key: str
    model_answer: str
    based_on_quotes: list[str]


class StudyMaterials(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: int = 1
    source_session_ids: list[str]
    summary: StudySummary
    jd_core_answers: list[StudyAnswer]


class SilenceEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start_s: float
    duration_s: float                 # only events >= 1.0s


class DeliveryMetrics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    wpm_overall: float                # candidate speech only
    wpm_timeline: list[float]         # per-minute buckets, candidate speech
    silence_events: list[SilenceEvent]
    filler_count: int
    filler_rate_per_min: float
    f0_variance: float | None         # None if pitch tracking failed
    avg_response_latency_s: float | None  # interviewer seg end -> next candidate start


class TimestampedObservation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    at_s: float
    kind: str                         # e.g. "hedging-intonation", "trailing-off"
    note: str                         # observed-signal language only
    conflicts_with_dsp: bool = False


class DimensionScore(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dimension_key: str
    score: float                      # 1.0-5.0
    evidence_quotes: list[str]        # verbatim quotes (content) / timestamps (delivery)
    rationale: str
    # F-03: what worked / what held the score down, per dimension. Defaults
    # keep every report stored before the fields existed validating.
    strengths: list[str] = []
    weaknesses: list[str] = []
    # F-48: the short span the judge itself marked as the finding -- a
    # verbatim substring of `rationale`, copied character for character, not
    # a paraphrase. None on every report stored before the field existed;
    # renderers then fall back to the positional first-sentence rule.
    key_span: str | None = None


class SessionReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str
    verdict: Literal["not_ready", "approaching", "ready"]
    # F-03: one-sentence takeaway, <= 120 chars; "" on reports stored before
    # the field existed (renderers fall back to the verdict phrase).
    headline: str = ""
    # F-04: how much evidence backed the numbers. "scored" = full session;
    # "limited" = 10-15 min, numbers stand but carry a limited-evidence
    # marker. Sessions below the floor never get a report at all -- they end
    # as status "insufficient" instead, so no third literal value here.
    eligibility: Literal["scored", "limited"] = "scored"
    overall_score: float              # weighted by rubric dimension weights
    dimension_scores: list[DimensionScore]   # one per rubric dimension (both channels)
    delivery_metrics: DeliveryMetrics
    delivery_observations: list[TimestampedObservation]
    strengths: list[str]
    gaps: list[str]
    next_drills: list[str]            # concrete, dimension-linked
    limits_note: str                  # honest-limits boilerplate


@runtime_checkable
class GenAIModelsLike(Protocol):
    """Minimal surface of genai.Client().models used by the scorer."""

    def generate_content(self, *, model: str, contents: Any,
                         config: Any = None) -> Any:
        ...


@runtime_checkable
class GenAIFilesLike(Protocol):
    """Minimal surface of genai.Client().files used by the scorer."""

    def upload(self, *, file: Any) -> Any:
        ...


@runtime_checkable
class GenAIClientLike(Protocol):
    """Structural type satisfied by both genai.Client and tests' FakeGenAI."""

    models: GenAIModelsLike
    files: GenAIFilesLike
