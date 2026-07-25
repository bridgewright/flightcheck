"""Candidate profile intake: PDF text extraction (profile normalization next)."""
from __future__ import annotations

import io

from pypdf import PdfReader


def extract_pdf_text(pdf_bytes: bytes) -> str:
    """Extract plain text from PDF bytes (resume upload / LinkedIn Save-to-PDF)."""
    reader = PdfReader(io.BytesIO(pdf_bytes))
    return "\n".join(page.extract_text() or "" for page in reader.pages).strip()
