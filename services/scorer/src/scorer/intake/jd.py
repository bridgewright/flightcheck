"""JD intake: fetch a job description URL and reduce it to clean text.

html_to_text is the pure function under test; fetch_jd is a thin network
wrapper around it so tests never touch the network (global test gate).

fetch_jd is reachable from the public intake form (web POST /api/packages ->
worker create_package), so it is an SSRF surface: every URL is validated
before any request -- scheme allowlist (http/https), and the host must
resolve only to public addresses (loopback, private, link-local, and cloud
metadata ranges are rejected). Redirects are followed manually so every hop
is re-validated, and the response body is size-capped. All rejections raise
the typed JdFetchError so the API layer can map them to a clean 422.
"""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urljoin, urlsplit

import httpx
from bs4 import BeautifulSoup

_TIMEOUT_S = 20.0
_MAX_REDIRECTS = 5
_MAX_RESPONSE_BYTES = 2_000_000


class JdFetchError(Exception):
    """The JD URL is invalid, unsafe to fetch, or the fetch failed."""


def html_to_text(html: str) -> str:
    """Drop chrome tags, then collapse every whitespace run to one space."""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav", "footer"]):
        tag.decompose()
    return " ".join(soup.get_text(separator=" ").split())


def _validate_url(url: str) -> None:
    """Reject non-http(s) schemes and hosts that resolve to non-public IPs.

    ip.is_global is False for loopback (127/8), RFC1918 private ranges,
    link-local (169.254/16 -- which includes the 169.254.169.254 cloud
    metadata endpoint), CGNAT, unspecified, and reserved ranges; globally
    routable multicast is excluded explicitly. Every resolved address must
    pass, so a host with one public and one private A record is rejected.
    """
    parsed = urlsplit(url)
    if parsed.scheme not in ("http", "https"):
        raise JdFetchError(
            f"unsupported URL scheme {parsed.scheme!r}: only http and https are allowed"
        )
    host = parsed.hostname
    if not host:
        raise JdFetchError("URL has no host")
    try:
        infos = socket.getaddrinfo(host, None)
    except (socket.gaierror, UnicodeError) as exc:
        raise JdFetchError(f"could not resolve host {host!r}") from exc
    if not infos:
        raise JdFetchError(f"could not resolve host {host!r}")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global or ip.is_multicast:
            raise JdFetchError(
                f"host {host!r} resolves to a non-public address; refusing to fetch"
            )


def _read_capped(response: httpx.Response) -> str:
    """Read a streamed body up to the size cap, then decode it."""
    chunks: list[bytes] = []
    total = 0
    for chunk in response.iter_bytes():
        total += len(chunk)
        if total > _MAX_RESPONSE_BYTES:
            raise JdFetchError(
                f"response larger than {_MAX_RESPONSE_BYTES} bytes; not a JD page"
            )
        chunks.append(chunk)
    encoding = response.charset_encoding or "utf-8"
    try:
        return b"".join(chunks).decode(encoding, errors="replace")
    except LookupError:
        return b"".join(chunks).decode("utf-8", errors="replace")


def fetch_jd(url: str) -> str:
    """Fetch a JD page and return its visible text.

    Raises JdFetchError for unsafe/invalid URLs and oversized bodies, and
    httpx errors (httpx.HTTPStatusError on non-2xx, transport errors on
    timeouts) otherwise, so the API layer maps every failure to a 422
    instead of compiling a rubric from an error page.
    """
    current = url
    with httpx.Client(timeout=_TIMEOUT_S, follow_redirects=False) as client:
        for _ in range(_MAX_REDIRECTS + 1):
            _validate_url(current)
            with client.stream("GET", current) as response:
                if response.is_redirect:
                    location = response.headers.get("location")
                    if not location:
                        raise JdFetchError("redirect response without a Location header")
                    current = urljoin(current, location)
                    continue
                response.raise_for_status()
                return html_to_text(_read_capped(response))
    raise JdFetchError(f"more than {_MAX_REDIRECTS} redirects; refusing to follow")
