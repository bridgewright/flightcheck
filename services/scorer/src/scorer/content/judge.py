"""Content judge: scores content-channel rubric dimensions against the transcript.

Three focused Gemini samples per content dimension, averaged. The prompt
carries the candidate-labeled transcript (with timestamps) and that one
dimension's BARS anchors verbatim, so scores anchor to observable behavior.
Scoring every dimension in a single batched call was measured (evals layer 1,
release prep) to saturate the responsive dimension at 5.0 by contrast with the
evidence-poor ones — strong and borderline answers became indistinguishable;
the same judge with a single-dimension prompt separated them. Returned
evidence quotes are verified in code against the actual candidate speech —
fabricated quotes are dropped, a score left with no verifiable quote is
flagged in its rationale (score kept), off-dimension keys are dropped. The
same single call also authors, per dimension, the key span (F-48: the one
clause of the rationale that carries the finding, enforced in code to be an
exact substring of the stored rationale, else None) and the
strengths/weaknesses lists (F-03b) — never a second model call. A
sample whose reply fails to parse or omits its dimension is retried once per
dimension — the interview it scores is a non-repeatable 20 minutes, so one
malformed reply must not fail the whole run; a second failure for the same
dimension raises ContentJudgeError. Dimensions are scored concurrently under
a bounded thread pool (their calls are independent and network-dominated);
results still assemble in rubric dimension order and each dimension keeps
its own retry budget. Transient 429/5xx/transport failures back off through
the shared policy (scorer/resilience.py) with a budget separate from the
parse retry.
"""
from __future__ import annotations

import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor

from pydantic import BaseModel, ConfigDict, ValidationError

from scorer.config import load_product_config
from scorer.promptsafe import fence
from scorer.resilience import call_with_retry
from scorer.schemas import (
    DimensionScore,
    GenAIClientLike,
    Rubric,
    RubricDimension,
    TranscriptSegment,
)

logger = logging.getLogger(__name__)


class ContentJudgeError(Exception):
    """The judge response is unusable (parse failure or a missing dimension)."""


class ContentScoreDoc(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scores: list[DimensionScore]


# The scoring procedure below exists because of a measured failure mode (evals
# layer 1, release prep): scored in isolation, fluent score-3 answers saturated
# to 5.0 — strong and borderline became indistinguishable while weak stayed
# separated. The human blind-rank separated all three, so the judge, not the
# data, was fixed: classify to the nearest anchor first (BARS methodology),
# then interpolate, so the score-3 anchor is a live option, not a failure mode.
_RULES = (
    "Scoring rules:\n"
    "- Scoring procedure, per dimension: (1) read all three BARS anchors as\n"
    "  competing descriptions of the same answer; (2) pick the ONE anchor (1, 3,\n"
    "  or 5) whose behavior description fits the candidate's actual words most\n"
    "  closely — the limiting language in an anchor (\"some\", \"may lack depth\",\n"
    "  \"may need guidance\") describes real, competent answers, and an answer it\n"
    "  describes belongs at that anchor; (3) set the score within 1.0 of the\n"
    "  chosen anchor, citing the neighboring anchor's language for any shift.\n"
    "- Calibrate against the anchors, not the answer's fluency. An articulate\n"
    "  answer that names best practices without concrete specifics (numbers,\n"
    "  named tools, explicit trade-off decisions, lived detail) fits the middle\n"
    "  anchor, not the top one. Reserve scores above 4.0 for answers the score-5\n"
    "  description fits without qualification.\n"
    "- When torn between two scores, give the lower one and name the missing\n"
    "  behavior in the rationale.\n"
    "- evidence_quotes must be verbatim quotes from CANDIDATE lines of the transcript.\n"
    "  Never quote interviewer lines and never paraphrase.\n"
    "- rationale must tie the quoted evidence to the anchor language it matches.\n"
    "- Give no credit for anything the interviewer said; only candidate speech counts.\n"
    "- Return a score for every listed dimension, using its exact dimension key.\n"
    "- Score with one-decimal precision (for example 4.3, 4.7). A 5.0 means\n"
    "  nothing at all could be improved; if you can name any concrete way the\n"
    "  answer falls short of the score-5 anchor at its best, score 4.9 or lower\n"
    "  and name that shortfall in the rationale.\n"
    "- strengths: 1-3 short items, each naming one concrete thing this answer\n"
    "  did well on this dimension, tied to the candidate's actual words.\n"
    "- weaknesses: 1-3 short items, each naming a concrete behavior the anchors\n"
    "  reward that this answer did not show. Name what was missing from the\n"
    "  answer; describe the answer, never the person, and never assert an\n"
    "  inner state.\n"
    "- key_span: after writing the rationale, copy the ONE clause or sentence\n"
    "  of that rationale that carries the finding. It must be VERBATIM from\n"
    "  the rationale you just wrote, character for character; never\n"
    "  paraphrase, shorten, or reword it."
)


def _fmt_ts(seconds: float) -> str:
    total = int(seconds)
    return f"[{total // 60:02d}:{total % 60:02d}]"


# Injection posture (F-11a): the key span needs no new fencing. It is
# constrained by construction to an exact substring of the judge-authored
# rationale -- prose the product already stores and renders -- so it can
# carry nothing the rationale does not already carry. The rationale may echo
# candidate speech (the rules tell the judge to tie evidence to anchors),
# but that speech reached the judge inside the UNTRUSTED TRANSCRIPT fence
# (_build_prompt), and the span is never fed back into any model prompt: it
# is display data the renderer locates by indexOf.
def _locate_span(rationale: str, span: str | None) -> str | None:
    """The exact substring of `rationale` the claimed span points at.

    An exact match wins. A whitespace-normalized match is accepted ONLY by
    resolving it back to the exact substring as it appears in the rationale:
    the renderer locates the span by indexOf, so the stored value must be a
    character-for-character slice. Anything else resolves to None -- a
    fabricated emphasis is worse than none, because the product's claim is
    that its verdicts are honest and arguable.
    """
    if span is None or not span.strip():
        return None
    if span in rationale:
        return span
    pattern = r"\s+".join(re.escape(token) for token in span.split())
    match = re.search(pattern, rationale)
    return match.group(0) if match else None


def _normalize_ws(text: str) -> str:
    return " ".join(text.split())


def _transcript_block(segments: list[TranscriptSegment]) -> str:
    return "\n".join(
        f"{_fmt_ts(seg.start_s)} {seg.speaker.upper()}: {seg.text}" for seg in segments
    )


def _dimension_block(dim: RubricDimension) -> str:
    signals = "\n".join(f"  - {signal}" for signal in dim.signals)
    anchors = "\n".join(f"  score {a.score}: {a.behavior}" for a in dim.anchors)
    return (
        f"Dimension key: {dim.key}\n"
        f"Name: {dim.name}\n"
        f"Signals:\n{signals}\n"
        f"BARS anchors:\n{anchors}"
    )


def _build_prompt(
    rubric: Rubric,
    content_dims: list[RubricDimension],
    segments: list[TranscriptSegment],
) -> str:
    dims = "\n\n".join(_dimension_block(d) for d in content_dims)
    return (
        f"You are scoring a mock interview for the role: {rubric.role_title}.\n"
        "Score ONLY the content dimensions listed below, using only the transcript.\n\n"
        # F-11a: spoken words are user input too — a candidate can SAY an
        # injection out loud; the transcript rides inside the data fence.
        "Transcript (timestamped, speaker-labeled):\n"
        f"{fence('TRANSCRIPT', _transcript_block(segments))}\n\n"
        f"Content dimensions to score:\n\n{dims}\n\n"
        f"{_RULES}"
    )


# Sample aggregation (measured, evals layer 1, release prep): a single judge
# call is not reproducible even at temperature 0 with a fixed seed — the same
# borderline answer flipped between 3.5 and 5.0 across identical calls, while
# the true strong/borderline separation is only a few tenths. Averaging three
# samples shrinks that call-to-call noise below the separation instead of
# betting the score on one draw. Distinct seeds label the draws; the mean (not
# the median) keeps every sample's information at one-hundredth granularity.
_JUDGE_SAMPLES = 3
_JUDGE_SEEDS = (7, 11, 13)

# Scoring wall-time is dominated by these independent Gemini calls (measured
# in production: 7 content dimensions x 3 samples = 21 sequential calls), so
# dimensions are scored concurrently — the google-genai client is thread-safe
# for generate_content. Samples stay sequential WITHIN a dimension: the
# retry-once budget and the retry-with-the-failed-seed-first order are
# per-dimension state, and with 8 workers covering the 7 production content
# dimensions, flattening samples into the pool would add retry coordination
# without reducing wall-time under the same worker bound.
_JUDGE_MAX_WORKERS = 8

# Transient-failure backoff (parallel review finding, 2026-07-29): per-session
# concurrency went 1->7, so a 429 or dropped connection mid-run is expected
# pressure, not a judge-quality problem. It gets its own short backoff budget
# so it never spends the one parse retry a dimension holds.
#
# v0.6 (F-37): the schedule this module invented is now the policy every
# model call site shares (scorer/resilience.py + config/resilience.toml).
# The numbers are unchanged -- 4 attempts at 1s/2s/4s -- except that the
# wait now carries jitter, because seven dimensions retrying in lockstep
# re-collide on the endpoint that was already refusing them.
_sleep = time.sleep  # kept as the module-level seam tests stub


def _generate_with_backoff(client: GenAIClientLike, **kwargs):
    return call_with_retry(
        lambda: client.models.generate_content(**kwargs),
        what="content judge",
        # Resolved through the module global on every call, so stubbing
        # judge._sleep still silences the wait in tests.
        sleep=lambda seconds: _sleep(seconds),
    )


def _score_dimension_once(
    model: str,
    rubric: Rubric,
    dim: RubricDimension,
    segments: list[TranscriptSegment],
    client: GenAIClientLike,
    seed: int,
) -> DimensionScore:
    response = _generate_with_backoff(
        client,
        model=model,
        contents=_build_prompt(rubric, [dim], segments),
        config={
            "response_mime_type": "application/json",
            "response_schema": ContentScoreDoc,
            "temperature": 0.0,
            "seed": seed,
        },
    )
    try:
        doc = ContentScoreDoc.model_validate_json(response.text)
    except ValidationError as exc:
        raise ContentJudgeError(
            f"content judge response for {dim.key!r} failed to parse"
        ) from exc
    score = next((s for s in doc.scores if s.dimension_key == dim.key), None)
    if score is None:
        raise ContentJudgeError(
            f"content judge response missing dimensions: {[dim.key]}"
        )
    return score


def _collect_samples(
    model: str,
    rubric: Rubric,
    dim: RubricDimension,
    segments: list[TranscriptSegment],
    client: GenAIClientLike,
) -> list[DimensionScore]:
    """The dimension's samples, with ONE retry per dimension on a bad reply.

    The session being scored is a non-repeatable 20-minute interview, so a
    single malformed judge reply (parse failure or missing dimension) must
    not fail the whole run. A second bad reply for the same dimension still
    raises: at that point the judge, not the draw, is the problem.
    """
    samples: list[DimensionScore] = []
    retried = False
    for seed in _JUDGE_SEEDS[:_JUDGE_SAMPLES]:
        try:
            samples.append(
                _score_dimension_once(model, rubric, dim, segments, client, seed)
            )
        except ContentJudgeError:
            if retried:
                raise
            retried = True
            logger.warning(
                "content judge sample failed (dimension=%s, seed=%s); retrying once",
                dim.key,
                seed,
            )
            samples.append(
                _score_dimension_once(model, rubric, dim, segments, client, seed)
            )
    return samples


def score_content(
    rubric: Rubric,
    segments: list[TranscriptSegment],
    client: GenAIClientLike,
) -> list[DimensionScore]:
    model = load_product_config().models.scorer
    candidate_text = _normalize_ws(
        " ".join(seg.text for seg in segments if seg.speaker == "candidate")
    )
    content_dims = [d for d in rubric.dimensions if d.channel == "content"]
    if not content_dims:
        return []
    # One task per dimension. pool.map yields results in input order (never
    # completion order), so the output stays deterministic, and the first
    # failing dimension in rubric order is the one whose ContentJudgeError
    # propagates — exactly as in the sequential version.
    with ThreadPoolExecutor(
        max_workers=min(_JUDGE_MAX_WORKERS, len(content_dims))
    ) as pool:
        sample_sets = list(
            pool.map(
                lambda dim: _collect_samples(model, rubric, dim, segments, client),
                content_dims,
            )
        )
    kept: list[DimensionScore] = []
    for samples in sample_sets:
        mean_score = round(sum(s.score for s in samples) / len(samples), 2)
        # Quotes and rationale come from the sample closest to the aggregate,
        # so the text always belongs to one real judge reply (ties -> first).
        spokesman = min(samples, key=lambda s: abs(s.score - mean_score))
        score = spokesman.model_copy(update={"score": mean_score})
        verified = [
            quote
            for quote in score.evidence_quotes
            if _normalize_ws(quote) and _normalize_ws(quote) in candidate_text
        ]
        if verified:
            score = score.model_copy(update={"evidence_quotes": verified})
        else:
            score = score.model_copy(
                update={
                    "evidence_quotes": [],
                    "rationale": "[no verifiable quote] " + score.rationale,
                }
            )
        # F-48 contract, enforced in code rather than in hope: the key span
        # must be an exact substring of the rationale it is stored with (the
        # final rationale, after any quote-verification prefix -- prefixing
        # only prepends, so a genuine span survives it). A span the judge did
        # not actually write in its rationale is dropped, not repaired.
        located = _locate_span(score.rationale, score.key_span)
        if located is None and score.key_span is not None and score.key_span.strip():
            logger.debug(
                "content judge key_span for %s is not a substring of its "
                "rationale; dropping the span",
                score.dimension_key,
            )
        if located != score.key_span:
            score = score.model_copy(update={"key_span": located})
        kept.append(score)
    return kept
