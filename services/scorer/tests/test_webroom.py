import datetime as dt
import json

import pytest

from scorer.webroom import server


class _Response:
    def __init__(self, payload: dict, status: int = 200):
        self._payload = payload
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"http {self.status_code}")

    def json(self):
        return self._payload


# -- OpenAI request shaping --
def test_openai_token_request_uses_ga_nested_schema():
    # Live-verified against POST /v1/realtime/client_secrets on 2026-07-25: the
    # response echoed silence_duration_ms=900 back inside session.audio.input.
    body = server.openai_token_request("gpt-realtime", "Be Morgan.")
    session = body["session"]
    assert session["type"] == "realtime"
    assert session["model"] == "gpt-realtime"
    assert session["instructions"] == "Be Morgan."          # top level, not under audio
    assert session["output_modalities"] == ["audio"]
    assert "modalities" not in session                      # pre-GA key must be gone
    assert "turn_detection" not in session                  # pre-GA flat location must be gone
    assert session["audio"]["input"]["turn_detection"] == {
        "type": "server_vad",
        "silence_duration_ms": 900,
        "prefix_padding_ms": 300,
    }


def test_openai_vad_tail_is_longer_than_a_thinking_pause():
    """The whole reason this harness replaces the mic runner: the provider default
    (~500 ms) ends a turn inside a pause, so the interviewer talks over the answer."""
    td = server.openai_token_request("m", "i")["session"]["audio"]["input"]["turn_detection"]
    assert td["silence_duration_ms"] >= 900


def test_extract_client_secret_reads_the_ga_flat_value():
    assert server.extract_client_secret({"value": "ek_abc", "expires_at": 1}) == "ek_abc"


def test_extract_client_secret_accepts_the_legacy_nested_shape():
    # The beta /realtime/sessions endpoint nested it; accepting both means a
    # provider rollback fails loudly rather than handing the page "Bearer ".
    assert server.extract_client_secret({"client_secret": {"value": "ek_x"}}) == "ek_x"


def test_extract_client_secret_rejects_a_response_without_one():
    with pytest.raises(RuntimeError, match="no client secret"):
        server.extract_client_secret({"error": {"message": "nope"}})


def test_mint_openai_never_returns_the_raw_api_key(monkeypatch):
    sent = {}

    def fake_post(url, headers=None, json=None, timeout=None):
        sent.update(url=url, headers=headers, body=json)
        return _Response({"value": "ek_minted", "expires_at": 1})

    monkeypatch.setenv("OPENAI_API_KEY", "sk-secret")
    monkeypatch.setattr(server.httpx, "post", fake_post)
    out = server.mint_openai_token()

    assert sent["url"] == server.OPENAI_CLIENT_SECRETS_URL
    assert sent["headers"]["Authorization"] == "Bearer sk-secret"
    assert "OpenAI-Beta" not in sent["headers"]      # GA rejects the beta header
    assert sent["body"]["session"]["instructions"].startswith("You are Morgan")
    assert out == {"value": "ek_minted", "model": server.load_bakeoff_config()
                   ["openai"]["realtime_model"], "auth": "ephemeral"}
    assert "sk-secret" not in json.dumps(out)


def test_mint_openai_requires_a_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY not set"):
        server.mint_openai_token()


# -- Gemini request shaping --
def test_gemini_token_config_constrains_the_session():
    now = dt.datetime(2026, 7, 25, 12, 0, tzinfo=dt.UTC)
    cfg = server.gemini_token_config("gemini-live", "Be Morgan.", now=now)

    assert cfg.uses == 1
    assert cfg.new_session_expire_time == now + server.GEMINI_CONNECT_WINDOW
    assert cfg.expire_time == now + server.GEMINI_SESSION_TTL
    assert cfg.http_options.api_version == "v1alpha"        # auth tokens are v1alpha only

    live = cfg.live_connect_constraints
    assert live.model == "gemini-live"
    assert live.config.system_instruction == "Be Morgan."
    assert [m.value for m in live.config.response_modalities] == ["AUDIO"]
    aad = live.config.realtime_input_config.automatic_activity_detection
    assert aad.silence_duration_ms == server.SILENCE_MS == 900
    assert aad.prefix_padding_ms == server.PREFIX_PADDING_MS


def test_gemini_token_locks_only_the_fields_it_sets():
    """`lock_additional_fields=[]` locks exactly the constrained fields. Resumption
    is deliberately left unlocked — the browser sends its own handle, and a locked
    value would ignore it, breaking reconnection mid-interview."""
    cfg = server.gemini_token_config("m", "i")
    assert cfg.lock_additional_fields == []
    assert cfg.live_connect_constraints.config.session_resumption is None


def test_mint_gemini_prefers_an_ephemeral_token(monkeypatch):
    captured = {}

    class _Tokens:
        def create(self, *, config):
            captured["config"] = config
            return type("AuthToken", (), {"name": "auth_tokens/abc"})()

    class _Client:
        def __init__(self, api_key):
            captured["api_key"] = api_key
            self.auth_tokens = _Tokens()

    monkeypatch.setenv("GEMINI_API_KEY", "gk-secret")
    monkeypatch.setattr("google.genai.Client", _Client)
    out = server.mint_gemini_token()

    assert out["auth"] == "ephemeral"
    assert out["value"] == "auth_tokens/abc"
    assert out["api_version"] == "v1alpha"
    assert "gk-secret" not in json.dumps(out)
    assert captured["config"].live_connect_constraints.config.system_instruction.startswith(
        "You are Morgan")


def test_mint_gemini_falls_back_to_the_raw_key_and_says_so(monkeypatch):
    """A localhost-only harness that cannot open a session is useless, so an
    ephemeral failure degrades instead of stopping — but it must be labelled, so
    the page can warn and nobody mistakes this for a production path."""
    class _Client:
        def __init__(self, api_key):
            self.auth_tokens = type("T", (), {
                "create": lambda self, *, config: (_ for _ in ()).throw(
                    RuntimeError("auth tokens unavailable"))})()

    monkeypatch.setenv("GEMINI_API_KEY", "gk-secret")
    monkeypatch.setattr("google.genai.Client", _Client)
    out = server.mint_gemini_token()

    assert out["auth"] == "raw-key-localhost-only"
    assert out["value"] == "gk-secret"
    assert "auth tokens unavailable" in out["note"]


# -- routing --
def test_root_serves_a_page_with_both_provider_buttons():
    status, ctype, body = server.handle("GET", "/")
    page = body.decode()
    assert status == 200 and ctype.startswith("text/html")
    assert "Interview with OpenAI" in page and "Interview with Gemini" in page
    # echo cancellation is the point of moving off the raw mic runner
    assert "echoCancellation: true" in page


def test_config_route_reports_both_models_and_the_vad_tail():
    status, _, body = server.handle("GET", "/config")
    payload = json.loads(body)
    cfg = server.load_bakeoff_config()
    assert status == 200
    assert payload["openai_model"] == cfg["openai"]["realtime_model"]
    assert payload["gemini_model"] == cfg["gemini"]["realtime_model"]
    assert payload["silence_duration_ms"] == 900


def test_prompt_route_serves_the_bakeoff_interviewer_prompt():
    status, ctype, body = server.handle("GET", "/prompt")
    assert status == 200 and ctype.startswith("text/plain")
    assert b"PRESSURE PROBES" in body


def test_token_route_returns_the_minted_payload(monkeypatch):
    monkeypatch.setattr(server, "mint_openai_token", lambda: {"value": "ek_1", "model": "m"})
    status, _, body = server.handle("POST", "/token/openai")
    assert status == 200 and json.loads(body)["value"] == "ek_1"


def test_token_route_reports_a_mint_failure_as_502(monkeypatch):
    def boom():
        raise RuntimeError("GEMINI_API_KEY not set")
    monkeypatch.setattr(server, "mint_gemini_token", boom)
    status, _, body = server.handle("POST", "/token/gemini")
    assert status == 502 and "GEMINI_API_KEY not set" in json.loads(body)["error"]


def test_unknown_route_is_a_404_not_a_traceback():
    status, _, body = server.handle("GET", "/../.env")
    assert status == 404 and "no route" in json.loads(body)["error"]


def test_get_token_route_is_not_served():
    # Minting is a POST; a GET must not mint, so a stray link cannot burn a token.
    assert server.handle("GET", "/token/openai")[0] == 404
