"""FastAPI worker: the HTTP surface over the compile and scoring pipelines.

create_app takes its collaborators (database, storage, Gemini client) as
arguments so tests exercise the real HTTP surface against fakes (house
pattern) -- no transport mocking. Auth is one bearer token
(WORKER_API_TOKEN) checked on every /api route; only /healthz is public.
Long jobs run as BackgroundTasks: POST returns 202 and clients poll GET.
"""
from __future__ import annotations

import base64
import logging
import os
import secrets
from typing import Annotated

import httpx
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    FastAPI,
    Header,
    HTTPException,
)
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from scorer.api.db import Database, PackageRow, SessionRow
from scorer.api.pipeline import compile_package, score_session
from scorer.api.storage import Storage
from scorer.intake.jd import JdFetchError, fetch_jd
from scorer.intake.profile import extract_pdf_text
from scorer.schemas import CandidateProfile, GenAIClientLike
from scorer.sessionplan.planner import (
    build_interviewer_instructions,
    plan_baseline_session,
)

logger = logging.getLogger(__name__)


class CreatePackageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    jd_text: str | None = None
    jd_url: str | None = None
    resume_text: str | None = None
    resume_pdf_b64: str | None = None
    linkedin_text: str | None = None
    linkedin_pdf_b64: str | None = None


class CreateSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    package_id: str


class CompleteSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    audio_path: str


def _empty_profile() -> CandidateProfile:
    """Fallback when the package has no stored candidate profile."""
    return CandidateProfile(
        name=None, headline=None, years_experience=None,
        roles=[], skills=[], achievements=[],
    )


def _require_worker_token(authorization: Annotated[str, Header()] = "") -> None:
    """Bearer auth against WORKER_API_TOKEN. Never log or echo either value.

    compare_digest keeps the comparison constant-time so response timing
    cannot leak how much of a guessed token matched.
    """
    expected = os.environ.get("WORKER_API_TOKEN", "")
    if not expected or not secrets.compare_digest(
        authorization, f"Bearer {expected}"
    ):
        raise HTTPException(status_code=401, detail="invalid or missing bearer token")


def _session_response(row: SessionRow, package: PackageRow) -> dict:
    """The POST /api/sessions payload for a session row (new or existing).

    Callers guarantee row.session_plan and package.rubric are present: a
    session row is only ever created for a "ready" package, with its plan.
    """
    profile = package.candidate_profile
    if profile is None:
        profile = _empty_profile()
    instructions = build_interviewer_instructions(
        row.session_plan, package.rubric, profile
    )
    return {
        "session_id": row.id,
        "session_plan": row.session_plan.model_dump(mode="json"),
        "interviewer_instructions": instructions,
    }


def _score_session_job(
    session_id: str, db: Database, storage: Storage, client: GenAIClientLike
) -> None:
    """Background wrapper: score_session records "failed" itself and re-raises;
    the app swallows here so a broken scoring job can never crash the worker."""
    try:
        score_session(session_id, db, storage, client)
    except Exception:
        logger.exception("background scoring failed: session_id=%s", session_id)


def create_app(db: Database, storage: Storage, client: GenAIClientLike) -> FastAPI:
    app = FastAPI(title="flightcheck scorer worker")
    api = APIRouter(prefix="/api", dependencies=[Depends(_require_worker_token)])

    @app.get("/healthz")
    def healthz() -> dict[str, bool]:
        return {"ok": True}

    @api.post("/packages", status_code=202)
    def create_package(body: CreatePackageRequest, background_tasks: BackgroundTasks):
        if body.jd_text is not None:
            jd_text = body.jd_text
        elif body.jd_url is not None:
            try:
                jd_text = fetch_jd(body.jd_url)
            except (JdFetchError, httpx.HTTPError):
                # Unsafe/unfetchable URL is a client problem, never a 500;
                # the message stays generic (no echoed URL, no exception text).
                return JSONResponse(
                    status_code=422,
                    content={
                        "error": "could not fetch that URL; paste the JD text instead"
                    },
                )
        else:
            raise HTTPException(
                status_code=422, detail="one of jd_text or jd_url is required"
            )
        resume_text = body.resume_text
        if resume_text is None and body.resume_pdf_b64 is not None:
            resume_text = extract_pdf_text(base64.b64decode(body.resume_pdf_b64))
        linkedin_text = body.linkedin_text
        if linkedin_text is None and body.linkedin_pdf_b64 is not None:
            linkedin_text = extract_pdf_text(base64.b64decode(body.linkedin_pdf_b64))
        row = db.create_package(jd_text, body.jd_url)
        background_tasks.add_task(
            compile_package,
            row.id,
            db,
            storage,
            client,
            resume_text=resume_text,
            linkedin_text=linkedin_text,
        )
        return {"package_id": row.id, "access_token": row.access_token}

    @api.get("/packages/by-token/{access_token}")
    def get_package_by_token(access_token: str) -> PackageRow:
        try:
            return db.get_package_by_token(access_token)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="package not found") from exc

    @api.post("/sessions")
    def create_session(body: CreateSessionRequest):
        """Create the package's baseline session -- idempotent.

        v0.1 is single-session per package, so when the package already has
        a session this returns that existing session's payload unchanged
        instead of creating another row. Besides making the paid trigger
        safe to retry, this closes the index-overwrite risk: every session
        is created at index 1, so a second row would share the first row's
        recording storage key and the later upload would silently replace
        the earlier session's audio.
        """
        try:
            package = db.get_package(body.package_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="package not found") from exc
        existing = db.list_sessions(body.package_id)
        if existing:
            return _session_response(existing[0], package)
        if package.status != "ready" or package.rubric is None:
            raise HTTPException(
                status_code=409,
                detail=f"package status is {package.status!r}; sessions need 'ready'",
            )
        plan = plan_baseline_session(package.rubric)
        row = db.create_session(body.package_id, 1, plan)
        return _session_response(row, package)

    @api.post("/sessions/{session_id}/complete", status_code=202)
    def complete_session(
        session_id: str, body: CompleteSessionRequest, background_tasks: BackgroundTasks
    ):
        try:
            row = db.get_session(session_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="session not found") from exc
        if row.status in ("scoring", "scored"):
            # Scoring is the expensive paid trigger; a session is scored at
            # most once. "planned" starts a run and "failed" allows a retry.
            return JSONResponse(
                status_code=409,
                content={
                    "error": f"session is already {row.status}; it cannot be re-scored"
                },
            )
        db.set_session_status(session_id, "scoring", audio_path=body.audio_path)
        background_tasks.add_task(_score_session_job, session_id, db, storage, client)
        return {"session_id": session_id, "status": "scoring"}

    @api.get("/sessions/{session_id}")
    def get_session(session_id: str) -> dict:
        """SessionRow fields + interviewer_instructions rebuilt on every read.

        The instructions are deterministic (plan + rubric + profile are all
        stored), so they are never persisted on the session row; only
        server-side callers -- the Next.js secret-minting route -- ever see
        them, and the browser has no other path to them.
        """
        try:
            row = db.get_session(session_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="session not found") from exc
        package = db.get_package(row.package_id)
        instructions = ""
        if row.session_plan is not None and package.rubric is not None:
            profile = package.candidate_profile
            if profile is None:
                profile = _empty_profile()
            instructions = build_interviewer_instructions(
                row.session_plan, package.rubric, profile
            )
        payload = row.model_dump(mode="json")
        payload["interviewer_instructions"] = instructions
        return payload

    app.include_router(api)
    return app


def main() -> None:
    """Deploy entrypoint: real Supabase + Gemini clients from env.

    scorer.env exposes load_env()/require_key() -- .env is authoritative
    (override=True) and a missing key fails loudly at startup (never
    load_dotenv). create_supabase_client() reads SUPABASE_URL and
    SUPABASE_SERVICE_ROLE_KEY itself; ONE Supabase client is built here
    and shared by SupabaseDatabase and SupabaseStorage (Task 2's
    composition contract).
    """
    import uvicorn

    from scorer.api.db import SupabaseDatabase, create_supabase_client
    from scorer.api.storage import SupabaseStorage
    from scorer.env import load_env, require_key
    from scorer.genai_compat import make_client

    load_env()
    require_key("WORKER_API_TOKEN")
    gemini_key = require_key("GEMINI_API_KEY")
    supabase = create_supabase_client()
    app = create_app(
        db=SupabaseDatabase(supabase),
        storage=SupabaseStorage(supabase),
        client=make_client(gemini_key),
    )
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8080")))


if __name__ == "__main__":
    main()
