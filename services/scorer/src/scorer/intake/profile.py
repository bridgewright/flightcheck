"""Candidate profile intake: PDF text extraction and profile normalization."""
from __future__ import annotations

import io
import json

from google.genai import types
from pypdf import PdfReader

from scorer.config import load_product_config
from scorer.schemas import CandidateProfile, GenAIClientLike

_PROFILE_PROMPT = (
    "You are extracting a structured candidate profile from the source "
    "documents below.\n"
    "Rules:\n"
    "- Extract only facts stated in the sources. Never invent, infer, or "
    "embellish.\n"
    "- If a field is not stated in the sources, use null (name, headline, "
    "years_experience) or an empty list (roles, skills, achievements).\n"
    "- List roles most recent first.\n"
    "- Keep achievements quantified exactly where the source quantifies "
    "them: reuse the source's numbers verbatim and never add numbers the "
    "source does not state.\n"
    "Source documents follow."
)


def extract_pdf_text(pdf_bytes: bytes) -> str:
    """Extract plain text from PDF bytes (resume upload / LinkedIn Save-to-PDF)."""
    reader = PdfReader(io.BytesIO(pdf_bytes))
    return "\n".join(page.extract_text() or "" for page in reader.pages).strip()


def build_profile(
    resume_text: str | None,
    linkedin_text: str | None,
    client: GenAIClientLike,
) -> CandidateProfile:
    """Normalize resume/LinkedIn text into a CandidateProfile.

    Exactly ONE generate_content call, structured via response_schema, then
    pydantic validation on the parsed JSON (pydantic is the validator of
    record).
    """
    if resume_text is None and linkedin_text is None:
        raise ValueError(
            "build_profile needs at least one of resume_text or linkedin_text")
    sections = [_PROFILE_PROMPT]
    if resume_text is not None:
        sections.append(f"## RESUME\n{resume_text}")
    if linkedin_text is not None:
        sections.append(f"## LINKEDIN PROFILE\n{linkedin_text}")
    product = load_product_config()
    response = client.models.generate_content(
        model=product.models.scorer,
        contents="\n\n".join(sections),
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=CandidateProfile,
        ),
    )
    return CandidateProfile.model_validate(json.loads(response.text))
