"""Tests for scorer.intake.jd -- HTML-to-text extraction and the fetch_jd
SSRF guards. No network: unsafe URLs are rejected before any request, IP
literals resolve locally, and fetch paths run through httpx.MockTransport."""
import socket

import httpx
import pytest

from scorer.intake.jd import JdFetchError, fetch_jd, html_to_text

JD_HTML = """
<html>
  <head>
    <title>Job: Senior Product Analyst</title>
    <style>.hero { color: red; }</style>
    <script>trackPageView();</script>
  </head>
  <body>
    <nav>Home | Careers | Login</nav>
    <h1>Senior   Product Analyst</h1>
    <p>
      Drive analytics for the growth team.
      You will   own dashboards and experiment readouts.
    </p>
    <div><span>Requirements:</span> SQL, Python, 4+ years experience.</div>
    <footer>&copy; 2026 ExampleCorp. Privacy. Terms.</footer>
  </body>
</html>
"""


def test_html_to_text_keeps_visible_text():
    text = html_to_text(JD_HTML)
    assert "Senior Product Analyst" in text
    assert "Drive analytics for the growth team." in text
    assert "SQL, Python, 4+ years experience." in text


def test_html_to_text_drops_script_style_nav_footer():
    text = html_to_text(JD_HTML)
    assert "trackPageView" not in text
    assert "color: red" not in text
    assert "Careers | Login" not in text
    assert "ExampleCorp" not in text


def test_html_to_text_collapses_whitespace():
    text = html_to_text(JD_HTML)
    assert "You will own dashboards and experiment readouts." in text
    assert "  " not in text
    assert "\n" not in text
    assert text == text.strip()


def test_html_to_text_handles_bare_text_fragments():
    assert html_to_text("plain text, no markup") == "plain text, no markup"


def _mock_fetch(monkeypatch, handler):
    """Route fetch_jd's internally built httpx.Client through MockTransport."""
    real_client = httpx.Client

    def patched(**kwargs):
        return real_client(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(httpx, "Client", patched)


@pytest.mark.parametrize("url", [
    "ftp://example.com/jd",
    "file:///etc/passwd",
    "not a url",
    "http:///no-host",
    "http://127.0.0.1/jd",              # loopback
    "http://10.0.0.8/jd",               # RFC1918 private
    "http://192.168.1.10/jd",           # RFC1918 private
    "http://169.254.169.254/latest/meta-data/",  # link-local cloud metadata
    "http://[::1]/jd",                  # IPv6 loopback
])
def test_fetch_jd_rejects_unsafe_urls_before_any_request(url):
    with pytest.raises(JdFetchError):
        fetch_jd(url)


def test_fetch_jd_rejects_hostname_resolving_to_private_ip(monkeypatch):
    def fake_getaddrinfo(host, port, *args, **kwargs):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.1.2.3", 0))]

    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)
    with pytest.raises(JdFetchError, match="non-public"):
        fetch_jd("http://internal.example/jd")


def test_fetch_jd_rejects_unresolvable_host(monkeypatch):
    def fake_getaddrinfo(host, port, *args, **kwargs):
        raise socket.gaierror("no such host")

    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)
    with pytest.raises(JdFetchError, match="resolve"):
        fetch_jd("http://no-such-host.invalid/jd")


def test_fetch_jd_fetches_public_url_and_extracts_text(monkeypatch):
    def handler(request):
        return httpx.Response(
            200,
            html="<html><body><h1>Senior  Analyst</h1><script>x()</script></body></html>",
        )

    _mock_fetch(monkeypatch, handler)
    assert fetch_jd("http://8.8.8.8/jd") == "Senior Analyst"


def test_fetch_jd_revalidates_every_redirect_hop(monkeypatch):
    def handler(request):
        if request.url.host == "8.8.8.8":
            return httpx.Response(
                302, headers={"location": "http://169.254.169.254/latest/meta-data/"}
            )
        raise AssertionError("the non-public redirect target must never be fetched")

    _mock_fetch(monkeypatch, handler)
    with pytest.raises(JdFetchError, match="non-public"):
        fetch_jd("http://8.8.8.8/jd")


def test_fetch_jd_stops_after_too_many_redirects(monkeypatch):
    def handler(request):
        return httpx.Response(302, headers={"location": "http://8.8.8.8/again"})

    _mock_fetch(monkeypatch, handler)
    with pytest.raises(JdFetchError, match="redirect"):
        fetch_jd("http://8.8.8.8/jd")


def test_fetch_jd_caps_response_size(monkeypatch):
    def handler(request):
        return httpx.Response(
            200, content=b"x" * 2_000_001, headers={"content-type": "text/html"}
        )

    _mock_fetch(monkeypatch, handler)
    with pytest.raises(JdFetchError, match="larger"):
        fetch_jd("http://8.8.8.8/jd")


def test_fetch_jd_raises_httpx_error_on_non_2xx(monkeypatch):
    def handler(request):
        return httpx.Response(403)

    _mock_fetch(monkeypatch, handler)
    with pytest.raises(httpx.HTTPStatusError):
        fetch_jd("http://8.8.8.8/jd")
