"""JD intake: fetch a job description URL and reduce it to clean text.

html_to_text is the pure function under test; fetch_jd is a thin network
wrapper around it so tests never touch the network (global test gate).

fetch_jd is reachable from the public intake form (web POST /api/packages ->
worker create_package), so it is an SSRF surface. Four guards, in order:

1. **Scheme and port allowlists.** http/https only, and only on 80/443:
   without a port restriction, a public-looking host still reaches an
   internal Redis, Memcached, or admin port on a machine that merely has a
   routable address.
2. **Address validation.** The host must resolve only to public addresses;
   loopback, private, link-local (including the 169.254.169.254 cloud
   metadata endpoint), CGNAT, and reserved ranges are rejected.
3. **Address pinning.** The request is then made TO THE ADDRESS THAT WAS
   VALIDATED, with the original hostname carried in the Host header and in
   the TLS SNI. This closes a DNS-rebinding TOCTOU: previously the resolver
   ran once for the check and again inside httpx, and an attacker
   controlling the DNS answer could return a public address to the first
   and 127.0.0.1 to the second.
4. **Content-type check.** Only HTML/plain text is read. A JD URL that
   answers with a PDF, an image, or application/octet-stream is not a job
   posting, and streaming it into a prompt is spend at best.

Redirects are followed manually so every hop repeats all four, and the
response body is size-capped. All rejections raise the typed JdFetchError
so the API layer can map them to a clean 422.
"""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx
from bs4 import BeautifulSoup

_TIMEOUT_S = 20.0
_MAX_REDIRECTS = 5
_MAX_RESPONSE_BYTES = 2_000_000
_DEFAULT_PORTS = {"http": 80, "https": 443}
# Only the two ports a public web page is served on. Everything else on a
# routable host is somebody's internal service.
_ALLOWED_PORTS = frozenset({80, 443})
# A job posting is a document. Anything else is either a mistake or a probe.
_ALLOWED_MEDIA_TYPES = frozenset({
    "text/html", "application/xhtml+xml", "text/plain",
})

# Markup that hides text from a human reader while leaving it in the DOM --
# the payload carrier for "the page a reviewer sees is not the text the
# model reads". Attribute-driven cases are handled separately below.
_HIDDEN_STYLE_MARKERS = (
    "display:none", "visibility:hidden", "font-size:0", "opacity:0",
)


class JdFetchError(Exception):
    """The JD URL is invalid, unsafe to fetch, or the fetch failed."""


def _is_hidden(tag) -> bool:
    """True when markup hides this element from a human reading the page."""
    if tag.has_attr("hidden"):
        return True
    if tag.get("aria-hidden") == "true":
        return True
    style = "".join(str(tag.get("style", "")).lower().split())
    return any(marker in style for marker in _HIDDEN_STYLE_MARKERS)


def html_to_text(html: str) -> str:
    """Drop chrome and hidden markup, then collapse whitespace runs.

    Hidden elements go too (F-11b): text a human reviewer cannot see on the
    page still reaches the rubric compiler, which makes an off-screen div
    the cheapest way to ship an instruction block inside a real posting.
    """
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "template"]):
        tag.decompose()
    for tag in soup.find_all(_is_hidden):
        tag.decompose()
    return " ".join(soup.get_text(separator=" ").split())


def _resolve_and_validate(url: str) -> tuple[str, str, int]:
    """Validate a URL and resolve it ONCE; returns (host, address, port).

    ip.is_global is False for loopback (127/8), RFC1918 private ranges,
    link-local (169.254/16 -- which includes the 169.254.169.254 cloud
    metadata endpoint), CGNAT, unspecified, and reserved ranges; globally
    routable multicast is excluded explicitly. Every resolved address must
    pass, so a host with one public and one private A record is rejected
    outright rather than raced.

    The address returned is the one the request must then be sent to: the
    check and the connection have to agree on a single answer, or the DNS
    can change between them.
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
        port = parsed.port or _DEFAULT_PORTS[parsed.scheme]
    except ValueError as exc:
        raise JdFetchError("URL has an invalid port") from exc
    if port not in _ALLOWED_PORTS:
        raise JdFetchError(
            f"port {port} is not a web port; only 80 and 443 are allowed"
        )
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
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
    return host, infos[0][4][0], port


def _pin_request(url: str, host: str, address: str) -> tuple[str, dict, dict]:
    """Rewrite `url` to target the validated address; returns the request parts.

    The hostname still travels: in the Host header, so virtual hosting
    resolves the right site, and in the TLS SNI, so certificate
    verification still checks the name the user typed rather than an IP.
    Neither is a security downgrade -- the socket goes to the address that
    passed validation, which is the entire point.
    """
    parsed = urlsplit(url)
    literal = f"[{address}]" if ":" in address else address
    netloc = literal if parsed.port is None else f"{literal}:{parsed.port}"
    pinned = urlunsplit(
        (parsed.scheme, netloc, parsed.path or "/", parsed.query, ""))
    host_literal = f"[{host}]" if ":" in host else host
    host_header = (host_literal if parsed.port is None
                   else f"{host_literal}:{parsed.port}")
    extensions = {"sni_hostname": host} if parsed.scheme == "https" else {}
    return pinned, {"Host": host_header}, extensions


def _check_media_type(response: httpx.Response) -> None:
    """Refuse anything that is not a readable document.

    An absent content-type is refused too: every real posting is served by
    a web server that sets one, so a missing header is either a probe or a
    machine that is not serving a web page.
    """
    media = response.headers.get("content-type", "").split(";")[0].strip().lower()
    if media not in _ALLOWED_MEDIA_TYPES:
        raise JdFetchError(
            f"that URL returned {media or 'no content type'}, not a readable "
            "job posting"
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
            host, address, _port = _resolve_and_validate(current)
            pinned, headers, extensions = _pin_request(current, host, address)
            with client.stream("GET", pinned, headers=headers,
                               extensions=extensions) as response:
                if response.is_redirect:
                    location = response.headers.get("location")
                    if not location:
                        raise JdFetchError("redirect response without a Location header")
                    # Resolved against the ORIGINAL url, never the pinned
                    # one: a relative Location must land back on the host
                    # the user asked for, not on an IP literal.
                    current = urljoin(current, location)
                    continue
                response.raise_for_status()
                _check_media_type(response)
                return html_to_text(_read_capped(response))
    raise JdFetchError(f"more than {_MAX_REDIRECTS} redirects; refusing to follow")
