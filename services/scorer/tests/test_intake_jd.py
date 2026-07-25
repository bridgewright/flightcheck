"""Tests for scorer.intake.jd -- pure HTML-to-text extraction (no network)."""
from scorer.intake.jd import html_to_text

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
