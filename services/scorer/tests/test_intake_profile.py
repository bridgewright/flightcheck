"""Tests for scorer.intake.profile -- PDF extraction + profile normalization."""
import io
import json

import pytest
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from fakes import FakeGenAI
from scorer.config import load_product_config
from scorer.intake.profile import build_profile, extract_pdf_text
from scorer.schemas import CandidateProfile


def _pdf_bytes(*pages: list[str]) -> bytes:
    """Synthesize a PDF in-memory with pypdf: one text line per entry per page."""
    writer = PdfWriter()
    for lines in pages:
        page = writer.add_blank_page(width=612, height=792)
        page[NameObject("/Resources")] = DictionaryObject({
            NameObject("/Font"): DictionaryObject({
                NameObject("/F1"): DictionaryObject({
                    NameObject("/Type"): NameObject("/Font"),
                    NameObject("/Subtype"): NameObject("/Type1"),
                    NameObject("/BaseFont"): NameObject("/Helvetica"),
                }),
            }),
        })
        ops = ["BT", "/F1 12 Tf", "72 720 Td"]
        for i, line in enumerate(lines):
            if i:
                ops.append("0 -16 Td")
            ops.append(f"({line}) Tj")
        ops.append("ET")
        stream = DecodedStreamObject()
        stream.set_data("\n".join(ops).encode("latin-1"))
        page[NameObject("/Contents")] = writer._add_object(stream)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def test_extract_pdf_text_single_page():
    data = _pdf_bytes(["Alex Example", "Senior Product Analyst"])
    text = extract_pdf_text(data)
    assert "Alex Example" in text
    assert "Senior Product Analyst" in text


def test_extract_pdf_text_joins_pages_in_order():
    data = _pdf_bytes(["Page one: analytics lead"],
                      ["Page two: led migration of 12 services"])
    text = extract_pdf_text(data)
    assert text.index("Page one") < text.index("Page two")


def test_extract_pdf_text_blank_pdf_returns_empty():
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    buf = io.BytesIO()
    writer.write(buf)
    assert extract_pdf_text(buf.getvalue()) == ""


PROFILE_JSON = {
    "name": "Alex Example",
    "headline": "Senior Product Analyst",
    "years_experience": "4+ years",
    "roles": ["Senior Product Analyst, ExampleCorp",
              "Product Analyst, SampleWorks"],
    "skills": ["SQL", "Python", "experiment design"],
    "achievements": ["Cut dashboard load time 40%"],
}

RESUME_TEXT = (
    "Alex Example. Senior Product Analyst at ExampleCorp since 2022. "
    "SQL, Python, experiment design. Cut dashboard load time 40%."
)
LINKEDIN_TEXT = (
    "Alex Example - Senior Product Analyst - 4+ years in product analytics."
)


def test_build_profile_returns_validated_profile():
    fake = FakeGenAI([json.dumps(PROFILE_JSON)])
    profile = build_profile(RESUME_TEXT, LINKEDIN_TEXT, fake)
    assert isinstance(profile, CandidateProfile)
    assert profile.name == "Alex Example"
    assert profile.years_experience == "4+ years"
    assert profile.roles[0] == "Senior Product Analyst, ExampleCorp"


def test_build_profile_makes_one_structured_call():
    fake = FakeGenAI([json.dumps(PROFILE_JSON)])
    build_profile(RESUME_TEXT, LINKEDIN_TEXT, fake)
    assert len(fake.calls) == 1
    config = fake.calls[0]["config"]
    assert config.response_mime_type == "application/json"
    assert config.response_schema is CandidateProfile


def test_build_profile_uses_configured_scorer_model():
    fake = FakeGenAI([json.dumps(PROFILE_JSON)])
    build_profile(RESUME_TEXT, LINKEDIN_TEXT, fake)
    assert fake.calls[0]["model"] == load_product_config().models.scorer


def test_build_profile_prompt_carries_sources_and_no_invention_rule():
    fake = FakeGenAI([json.dumps(PROFILE_JSON)])
    build_profile(RESUME_TEXT, None, fake)
    contents = fake.calls[0]["contents"]
    assert RESUME_TEXT in contents
    assert "Never invent" in contents
    assert "quantifie" in contents
    assert "LINKEDIN" not in contents


def test_build_profile_requires_at_least_one_source():
    fake = FakeGenAI([json.dumps(PROFILE_JSON)])
    with pytest.raises(ValueError):
        build_profile(None, None, fake)
    assert fake.calls == []


def test_build_profile_fences_resume_and_linkedin_as_untrusted():
    fake = FakeGenAI([json.dumps(PROFILE_JSON)])
    build_profile(RESUME_TEXT, LINKEDIN_TEXT, fake)
    contents = fake.calls[0]["contents"]
    assert "<<<BEGIN UNTRUSTED RESUME>>>" in contents
    assert "<<<END UNTRUSTED RESUME>>>" in contents
    assert "<<<BEGIN UNTRUSTED LINKEDIN PROFILE>>>" in contents
    assert contents.index(RESUME_TEXT) > contents.index(
        "<<<BEGIN UNTRUSTED RESUME>>>")
