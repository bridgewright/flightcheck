"""Background jobs: the swallow-and-log wrappers around the two pipelines.

Both are handed to FastAPI's BackgroundTasks by the routes that enqueue them.
They live in their own module (rather than beside the routes) because they
are not request code: they outlive the response, they own the worker's
crash-safety contract, and v0.6 Track B wraps them with a concurrency
semaphore, an overall deadline, and a dead-letter path. A module that takes
its collaborators as arguments can be tested for all of that on its own.

The contract both keep: a background task that raises takes the worker's
event loop down with it, so nothing here may propagate. The pipelines record
their own "failed" status first; these wrappers are the last line.
"""
from __future__ import annotations

import logging

from scorer.api.db import Database
from scorer.api.pipeline import compile_package, score_session
from scorer.api.storage import Storage
from scorer.schemas import GenAIClientLike

logger = logging.getLogger(__name__)


def score_session_job(
    session_id: str, db: Database, storage: Storage, client: GenAIClientLike
) -> None:
    """Background wrapper: score_session records "failed" itself and re-raises;
    the app swallows here so a broken scoring job can never crash the worker."""
    try:
        score_session(session_id, db, storage, client)
    except Exception:
        logger.exception("background scoring failed: session_id=%s", session_id)


def compile_package_job(
    package_id: str,
    db: Database,
    storage: Storage,
    client: GenAIClientLike,
    *,
    resume_text: str | None,
    linkedin_text: str | None,
) -> None:
    """Background wrapper mirroring score_session_job: compile_package records
    "failed" itself, but if even that status write throws (a double fault, e.g.
    a database outage) the app swallows here so the background task can never
    crash the worker -- the row may then stay "compiling" until retried."""
    try:
        compile_package(
            package_id,
            db,
            storage,
            client,
            resume_text=resume_text,
            linkedin_text=linkedin_text,
        )
    except Exception:
        logger.exception("background compile failed: package_id=%s", package_id)
