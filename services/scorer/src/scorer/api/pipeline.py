"""Worker pipelines: package compilation and session scoring.

Both jobs run as FastAPI BackgroundTasks. A broken LLM call or a missing
recording must surface to the user as status "failed", never as a hung
"compiling"/"scoring" row and never as a crashed worker. Logging carries
ids and tracebacks only -- never secrets.
"""
from __future__ import annotations

import logging
import os
import tempfile
from pathlib import Path

from google.genai import types
from pydantic import BaseModel, ConfigDict

from scorer.api.db import Database
from scorer.api.storage import Storage
from scorer.audio_utils import ensure_wav
from scorer.config import load_product_config
from scorer.content.judge import score_content
from scorer.content.transcribe import transcribe_verbatim
from scorer.delivery.dsp import compute_delivery_metrics
from scorer.delivery.judge import judge_delivery
from scorer.intake.profile import build_profile
from scorer.report.compile import compile_report
from scorer.research.sweep import run_sweep
from scorer.rubric.compiler import compile_rubric
from scorer.rubric.corpus import load_corpus, load_fewshots
from scorer.schemas import CandidateProfile, GenAIClientLike, SessionReport

logger = logging.getLogger(__name__)


class JdFacts(BaseModel):
    """Role title and company extracted from the JD (run_sweep needs both)."""

    model_config = ConfigDict(extra="forbid")

    role_title: str
    company: str | None


_JD_FACTS_PROMPT = (
    "Extract the role title and the hiring company from the job description "
    "below.\n"
    "Rules:\n"
    '- role_title: the job title as posted, for example "Senior Product '
    'Analyst".\n'
    "- company: the hiring company name exactly as the posting states it; "
    "null when the posting does not name one. Never invent a company name.\n\n"
    "Job description:\n"
)


def _extract_jd_facts(jd_text: str, client: GenAIClientLike) -> JdFacts:
    response = client.models.generate_content(
        model=load_product_config().models.scorer,
        contents=_JD_FACTS_PROMPT + jd_text,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=JdFacts,
        ),
    )
    return JdFacts.model_validate_json(response.text)


def _minimal_profile() -> CandidateProfile:
    """Profile used when the user supplied no resume/LinkedIn source."""
    return CandidateProfile(
        name=None,
        headline=None,
        years_experience=None,
        roles=[],
        skills=[],
        achievements=[],
    )


def _corpus_cache_dir() -> Path:
    env_dir = os.environ.get("SCORER_CORPUS_DIR")
    if env_dir:
        return Path(env_dir)
    # Worker cache, intentionally left for reuse within the process lifetime.
    return Path(tempfile.mkdtemp(prefix="flightcheck-corpus-"))


def compile_package(
    package_id: str,
    db: Database,
    storage: Storage,
    client: GenAIClientLike,
    *,
    resume_text: str | None = None,
    linkedin_text: str | None = None,
) -> None:
    """Intake -> research sweep -> rubric compile; ends "ready" or "failed".

    resume_text/linkedin_text arrive from the POST /api/packages handler
    (PackageRow does not store raw source documents).
    """
    try:
        row = db.get_package(package_id)
        if resume_text is not None or linkedin_text is not None:
            profile = build_profile(resume_text, linkedin_text, client)
        else:
            profile = _minimal_profile()
        db.set_package_profile(package_id, profile)
        facts = _extract_jd_facts(row.jd_text, client)
        corpus_dir = storage.sync_corpus(_corpus_cache_dir())
        corpus = load_corpus(corpus_dir)
        fewshots = load_fewshots(corpus_dir / "fewshot")
        findings = run_sweep(row.jd_text, facts.role_title, facts.company, client)
        rubric = compile_rubric(row.jd_text, profile, findings, corpus, fewshots, client)
        db.set_package_rubric(package_id, rubric, status="ready")
    except Exception:
        # Worker boundary: record the failure, never crash the background job.
        logger.exception("package compile failed: package_id=%s", package_id)
        db.set_package_rubric(package_id, None, status="failed")


def score_session(
    session_id: str,
    db: Database,
    storage: Storage,
    client: GenAIClientLike,
) -> SessionReport:
    """Download -> wav -> transcript -> DSP -> both judges -> compiled report.

    Ends with session status "scored" (report saved) or "failed". On failure
    the exception is re-raised after recording status: the registry return
    type is SessionReport, so this function cannot swallow-and-return; the
    API layer wraps it in a swallow-and-log background job (_score_session_job).
    """
    try:
        db.set_session_status(session_id, "scoring")
        row = db.get_session(session_id)
        package = db.get_package(row.package_id)
        rubric = package.rubric
        if row.audio_path is None or rubric is None:
            raise ValueError(
                f"session {session_id} is not scorable: audio_path="
                f"{row.audio_path!r}, rubric_present={rubric is not None}"
            )
        with tempfile.TemporaryDirectory(prefix="flightcheck-session-") as tmp:
            local = storage.download_recording(row.audio_path, Path(tmp))
            wav = ensure_wav(local)
            segments = transcribe_verbatim(wav, client)
            metrics = compute_delivery_metrics(wav, segments)
            content_scores = score_content(rubric, segments, client)
            delivery_dims = [d for d in rubric.dimensions if d.channel == "delivery"]
            delivery_scores, observations = judge_delivery(
                wav, metrics, delivery_dims, client
            )
        report = compile_report(
            session_id,
            rubric,
            content_scores + delivery_scores,
            metrics,
            observations,
        )
        db.save_report(session_id, report)
        db.set_session_status(session_id, "scored")
        return report
    except Exception:
        # Worker boundary: record the failure, then let the caller decide.
        logger.exception("session scoring failed: session_id=%s", session_id)
        db.set_session_status(session_id, "failed")
        raise
