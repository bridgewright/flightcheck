"""Tests for scorer.intake.profile -- PDF extraction (cycle 1)."""
import io

from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from scorer.intake.profile import extract_pdf_text


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
