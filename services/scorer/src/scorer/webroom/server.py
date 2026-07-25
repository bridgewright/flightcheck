"""Local browser session room for the manual bake-off interview sessions.

The `sounddevice` mic runner (`scorer.realtime_probe.mic`) interrupts the
speaker: there is no echo cancellation, so the interviewer's own voice re-enters
the mic and trips server VAD mid-answer, and the providers' default VAD tail
(~500 ms) is shorter than a thinking pause. A browser fixes both — `getUserMedia`
gives real AEC/NS/AGC, and the VAD tail is widened to 900 ms *server-side*, in
the session this process mints, so the page cannot forget to set it.

Localhost only, by design: the page holds a live provider credential, so the
server binds 127.0.0.1 and the credential never leaves this machine.

Routing lives in `handle()` — a pure `(method, path) -> (status, type, body)`
function — so the request shaping can be tested without opening a socket or
minting a real token.
"""
from __future__ import annotations

import datetime as dt
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import httpx

from ..env import load_env
from ..realtime_probe.openai_probe import load_bakeoff_config

HOST = "127.0.0.1"          # localhost only: this server hands out provider credentials
PORT = 8787
REPO = Path(__file__).resolve().parents[5]
PROMPT_PATH = REPO / "evals" / "suites" / "bakeoff" / "interviewer_prompt.md"
STATIC = Path(__file__).resolve().parent / "static"

# The whole point of this harness. Provider defaults end a turn after ~500 ms of
# silence, which is shorter than the pause a candidate takes to think — the
# interviewer then talks over them and the session measures the VAD, not the
# provider. 900 ms is past a thinking pause and still short enough that the
# interviewer does not feel slow.
SILENCE_MS = 900
PREFIX_PADDING_MS = 300

OPENAI_CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets"

# Ephemeral-token lifetimes. `new_session_expire_time` bounds how long the minted
# token can *start* a session (the page connects within a second of the click);
# `expire_time` bounds the session itself — manual sessions are ~10 min, the
# stability protocol runs 22, so 45 min covers both with resumptions.
GEMINI_CONNECT_WINDOW = dt.timedelta(minutes=2)
GEMINI_SESSION_TTL = dt.timedelta(minutes=45)


# -- request shaping (pure, unit-tested) --
def openai_token_request(model: str, instructions: str) -> dict:
    """Body for `POST /v1/realtime/client_secrets` (GA nested session shape).

    Same schema as `OpenAIProbe._session_update`, which was live-verified:
    `session.type="realtime"` discriminator, `output_modalities` (not the
    pre-GA `modalities`), and `turn_detection` under `session.audio.input` —
    at the pre-GA top level it is silently ignored and the tail stays at the
    server default, which is the bug this harness exists to fix.
    """
    return {
        "session": {
            "type": "realtime",
            "model": model,
            "instructions": instructions,
            "output_modalities": ["audio"],
            "audio": {
                "input": {
                    "turn_detection": {
                        "type": "server_vad",
                        "silence_duration_ms": SILENCE_MS,
                        "prefix_padding_ms": PREFIX_PADDING_MS,
                    }
                }
            },
        }
    }


def extract_client_secret(payload: dict) -> str:
    """Pull the ephemeral key out of a client_secrets response.

    GA returns it flat at `.value`; the beta `/realtime/sessions` endpoint
    nested it under `.client_secret.value`. Both are accepted so a provider
    rollback does not silently yield an empty Bearer token.
    """
    value = payload.get("value")
    if not value:
        nested = payload.get("client_secret")
        value = nested.get("value") if isinstance(nested, dict) else nested
    if not isinstance(value, str) or not value:
        raise RuntimeError(f"no client secret in response: {sorted(payload)}")
    return value


def gemini_token_config(model: str, instructions: str, now: dt.datetime | None = None):
    """Constrained ephemeral-token config for the Live API.

    `live_connect_constraints` locks the fields set here, so a token leaking off
    this machine can only ever run *this* interviewer, in audio, with this VAD —
    it is not a general-purpose Gemini key. `session_resumption` is deliberately
    left unlocked: the browser has to send its own handle to resume, and a locked
    value would ignore it. `lock_additional_fields=[]` means "lock exactly the
    fields set above, nothing more" (an omitted list locks the whole config).
    """
    from google.genai import types

    now = now or dt.datetime.now(dt.UTC)
    return types.CreateAuthTokenConfig(
        uses=1,                                     # one session; the page mints per click
        expire_time=now + GEMINI_SESSION_TTL,
        new_session_expire_time=now + GEMINI_CONNECT_WINDOW,
        live_connect_constraints=types.LiveConnectConstraints(
            model=model,
            config=types.LiveConnectConfig(
                response_modalities=["AUDIO"],
                system_instruction=instructions,
                realtime_input_config=types.RealtimeInputConfig(
                    automatic_activity_detection=types.AutomaticActivityDetection(
                        silence_duration_ms=SILENCE_MS,
                        prefix_padding_ms=PREFIX_PADDING_MS,
                    )
                ),
            ),
        ),
        lock_additional_fields=[],
        http_options=types.HttpOptions(api_version="v1alpha"),
    )


# -- minting --
def mint_openai_token() -> dict:
    """Mint an OpenAI Realtime ephemeral key. The raw API key never leaves here."""
    cfg = load_bakeoff_config()
    model = cfg["openai"]["realtime_model"]
    key = os.environ.get("OPENAI_API_KEY", "")
    if not key:
        raise RuntimeError("OPENAI_API_KEY not set — add it to services/scorer/.env")
    r = httpx.post(
        OPENAI_CLIENT_SECRETS_URL,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json=openai_token_request(model, PROMPT_PATH.read_text()),
        timeout=30.0,
    )
    r.raise_for_status()
    return {"value": extract_client_secret(r.json()), "model": model, "auth": "ephemeral"}


def mint_gemini_token() -> dict:
    """Mint a constrained Gemini Live ephemeral token, or fall back to the raw key.

    google-genai 2.14 does support ephemeral auth tokens (`client.auth_tokens.create`,
    v1alpha) and that is the path taken — live-verified end to end on 2026-07-25: a
    minted token opened a Live session and returned audio with an *empty* client
    config, which is the proof that the constraints below are what the session runs
    on. (v1beta accepts the token too; v1alpha is used because the SDKs log a warning
    on anything else.) The fallback exists because the API marks
    the feature experimental: if the SDK or the account drops support, a localhost
    harness should still open a session rather than die, so the raw key is returned
    with `auth="raw-key-localhost-only"` and the reason attached. That is acceptable
    ONLY because this server is bound to 127.0.0.1 and the page is the sole client —
    it must never become the production path.
    """
    from google import genai

    cfg = load_bakeoff_config()
    model = cfg["gemini"]["realtime_model"]
    key = os.environ.get("GEMINI_API_KEY", "")
    if not key:
        raise RuntimeError("GEMINI_API_KEY not set — add it to services/scorer/.env")
    client = genai.Client(api_key=key)
    try:
        token = client.auth_tokens.create(
            config=gemini_token_config(model, PROMPT_PATH.read_text())
        )
        if not getattr(token, "name", None):
            raise RuntimeError("auth_tokens.create returned no token name")
        return {"value": token.name, "model": model,
                "auth": "ephemeral", "api_version": "v1alpha"}
    except Exception as exc:  # noqa: BLE001 — any ephemeral failure degrades, it does not stop the harness
        print(f"[webroom] ephemeral Gemini token failed ({exc!r}) — falling back to raw key")
        return {"value": key, "model": model, "auth": "raw-key-localhost-only",
                "api_version": "v1alpha", "note": repr(exc)}


# -- routing (pure, unit-tested) --
def _json(status: int, payload: dict) -> tuple[int, str, bytes]:
    return status, "application/json", json.dumps(payload).encode()


def handle(method: str, path: str) -> tuple[int, str, bytes]:
    """Route one request. Returns (status, content-type, body)."""
    if method == "GET" and path in ("/", "/index.html"):
        return 200, "text/html; charset=utf-8", (STATIC / "index.html").read_bytes()
    if method == "GET" and path == "/favicon.ico":
        # Chrome asks unprompted; a 404 here paints a red error in the console the
        # human is using to debug a session, so answer it with nothing.
        return 204, "image/x-icon", b""
    if method == "GET" and path == "/prompt":
        return 200, "text/plain; charset=utf-8", PROMPT_PATH.read_bytes()
    if method == "GET" and path == "/config":
        cfg = load_bakeoff_config()
        return _json(200, {
            "openai_model": cfg["openai"]["realtime_model"],
            "gemini_model": cfg["gemini"]["realtime_model"],
            "silence_duration_ms": SILENCE_MS,
            "prefix_padding_ms": PREFIX_PADDING_MS,
        })
    if method == "POST" and path in ("/token/openai", "/token/gemini"):
        mint = mint_openai_token if path.endswith("openai") else mint_gemini_token
        try:
            return _json(200, mint())
        except Exception as exc:  # noqa: BLE001 — a mint failure is a page-visible 502, not a dead server
            return _json(502, {"error": repr(exc)})
    return _json(404, {"error": f"no route for {method} {path}"})


class Handler(BaseHTTPRequestHandler):
    server_version = "flightcheck-webroom"

    def _respond(self, method: str) -> None:
        path = self.path.split("?", 1)[0]
        try:
            status, ctype, body = handle(method, path)
        except Exception as exc:  # noqa: BLE001 — never let one bad request kill the session room
            status, ctype, body = _json(500, {"error": repr(exc)})
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")   # the page is edited live
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        self._respond("GET")

    def do_POST(self) -> None:
        self._respond("POST")

    def log_message(self, fmt: str, *args) -> None:
        print(f"[webroom] {fmt % args}", flush=True)


def main() -> None:
    load_env()
    with ThreadingHTTPServer((HOST, PORT), Handler) as httpd:
        # flush: stdout is block-buffered whenever this is piped, and a session
        # room whose URL only appears after the first request is useless.
        print(f"open http://localhost:{PORT}", flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nwebroom stopped.")


if __name__ == "__main__":
    main()
