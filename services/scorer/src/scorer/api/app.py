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
from typing import Annotated

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    FastAPI,
    Header,
    HTTPException,
)
from pydantic import BaseModel, ConfigDict

from scorer.api.db import Database, PackageRow
from scorer.api.pipeline import compile_package
from scorer.api.storage import Storage
from scorer.intake.jd import fetch_jd
from scorer.intake.profile import extract_pdf_text
from scorer.schemas import GenAIClientLike

logger = logging.getLogger(__name__)


class CreatePackageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    jd_text: str | None = None
    jd_url: str | None = None
    resume_text: str | None = None
    resume_pdf_b64: str | None = None
    linkedin_text: str | None = None
    linkedin_pdf_b64: str | None = None


def _require_worker_token(authorization: Annotated[str, Header()] = "") -> None:
    """Bearer auth against WORKER_API_TOKEN. Never log or echo either value."""
    expected = os.environ.get("WORKER_API_TOKEN", "")
    if not expected or authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="invalid or missing bearer token")


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
            jd_text = fetch_jd(body.jd_url)
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
    from google import genai

    from scorer.api.db import SupabaseDatabase, create_supabase_client
    from scorer.api.storage import SupabaseStorage
    from scorer.env import load_env, require_key

    load_env()
    require_key("WORKER_API_TOKEN")
    gemini_key = require_key("GEMINI_API_KEY")
    supabase = create_supabase_client()
    app = create_app(
        db=SupabaseDatabase(supabase),
        storage=SupabaseStorage(supabase),
        client=genai.Client(api_key=gemini_key),
    )
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8080")))


if __name__ == "__main__":
    main()
