"""Crash-safe study background job.

This intentionally lives outside api/jobs.py because that shared file is frozen
while five batch tracks work in parallel; the separate module preserves file
ownership without weakening the background-task swallow-everything contract.
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime

from scorer.study.generate import generate_study

logger = logging.getLogger(__name__)


def _facts(db, package_id: str) -> list[dict]:
    facts = []
    for session in db.list_sessions(package_id):
        report = session.report
        if report is None or report.eligibility not in ("scored", "limited"):
            continue
        insights = db.get_session_insights(session.id)
        facts.append({
            "session_id": session.id,
            "index": session.index,
            "overall": report.overall_score,
            "dimension_scores": [
                score.model_dump(mode="json") for score in report.dimension_scores
            ],
            "gaps": report.gaps,
            "weaknesses": [item for score in report.dimension_scores for item in score.weaknesses],
            "insights": None if insights is None else insights.model_dump(mode="json"),
        })
    return facts


def generate_study_job(package_id: str, db, client) -> None:
    """Generate and persist a document; no exception may escape FastAPI."""
    try:
        package = db.get_package(package_id)
        document = generate_study(package, _facts(db, package_id), client)
        db.save_study_materials(package_id, document, datetime.now(UTC).isoformat())
    except Exception:
        try:
            db.fail_study_generation(package_id)
        except Exception:
            logger.exception("could not record failed study generation: package_id=%s", package_id)
        logger.exception("background study generation failed: package_id=%s", package_id)
