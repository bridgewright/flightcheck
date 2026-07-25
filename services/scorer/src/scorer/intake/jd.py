"""JD intake: fetch a job description URL and reduce it to clean text.

html_to_text is the pure function under test; fetch_jd is a thin network
wrapper around it so tests never touch the network (global test gate).
"""
from __future__ import annotations

import httpx
from bs4 import BeautifulSoup

_TIMEOUT_S = 20.0


def html_to_text(html: str) -> str:
    """Drop chrome tags, then collapse every whitespace run to one space."""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav", "footer"]):
        tag.decompose()
    return " ".join(soup.get_text(separator=" ").split())


def fetch_jd(url: str) -> str:
    """Fetch a JD page and return its visible text.

    Raises httpx.HTTPStatusError on non-2xx so the pipeline (Task 12) marks
    the package "failed" loudly instead of compiling a rubric from an error
    page.
    """
    response = httpx.get(url, timeout=_TIMEOUT_S, follow_redirects=True)
    response.raise_for_status()
    return html_to_text(response.text)
