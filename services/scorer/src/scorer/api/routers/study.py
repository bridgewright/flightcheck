"""Package study generation, status, and live bookmark join routes."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import JSONResponse

from scorer.api.deps import Deps
from scorer.api.quota import is_expired
from scorer.api.responses import rate_limited
from scorer.study.job import generate_study_job


def _eligible(rows):
    return [row for row in rows if row.report is not None
            and row.report.eligibility in ("scored", "limited")]


def _is_stale(updated_at: str | None, window_s: float) -> bool:
    if updated_at is None:
        return True
    return datetime.fromisoformat(updated_at) < datetime.now(UTC) - timedelta(seconds=window_s)


def build_router(deps: Deps) -> APIRouter:
    router = APIRouter()
    db = deps.db

    def package(package_id: str):
        try:
            return db.get_package(package_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="package not found") from exc

    @router.post("/packages/{package_id}/study", status_code=202)
    def start(package_id: str, background_tasks: BackgroundTasks):
        pkg = package(package_id)
        if is_expired(pkg):
            return JSONResponse(
                status_code=410,
                content={"error": "package expired", "code": "package-expired"},
            )
        if not deps.study_limiter.hit(pkg.user_id or pkg.id):
            return rate_limited("study-generation")
        row = db.get_study(package_id)
        if row is not None and row.status == "generating" and not _is_stale(
            row.updated_at, deps.limits.study_generating_stale_after_s
        ):
            return JSONResponse(
                status_code=409,
                content={
                    "error": "study generation is already running",
                    "code": "study-generating",
                },
            )
        if not _eligible(db.list_sessions(package_id)):
            return JSONResponse(
                status_code=409,
                content={"error": "no scored sessions", "code": "no-scored-sessions"},
            )
        db.begin_study_generation(package_id)
        background_tasks.add_task(generate_study_job, package_id, db, deps.client)
        return {"package_id": package_id, "status": "generating"}

    @router.get("/packages/{package_id}/study")
    def get_study(package_id: str):
        package(package_id)
        row = db.get_study(package_id)
        current = {session.id for session in _eligible(db.list_sessions(package_id))}
        if row is None:
            return {
                "package_id": package_id, "status": "none", "stale": False,
                "generated_at": None, "doc": None,
            }
        status = row.status
        if status == "generating" and _is_stale(
            row.updated_at, deps.limits.study_generating_stale_after_s
        ):
            status = "failed"
        stale = row.doc is not None and set(row.doc.source_session_ids) != current
        return {"package_id": package_id, "status": status, "stale": stale,
                "generated_at": row.generated_at, "doc": row.doc}

    @router.get("/packages/{package_id}/bookmarks")
    def bookmarks(package_id: str):
        package(package_id)
        sessions = []
        for session in sorted(db.list_sessions(package_id), key=lambda item: item.index):
            paraphrases = db.get_session_paraphrases(session.id)
            marks = db.get_paraphrase_marks(session.id)
            if paraphrases is None:
                continue
            items = [item for item in paraphrases.items
                     if marks.marks.get(str(item.turn_index)) is not None
                     and marks.marks[str(item.turn_index)].bookmarked]
            if items:
                sessions.append({
                    "session_id": session.id,
                    "session_index": session.index,
                    "items": items,
                })
        return {"package_id": package_id, "sessions": sessions}

    return router
