"""One id per unit of work, carried from the web into the worker's logs.

The web generates an x-request-id for each inbound request and forwards it
on every worker call it makes (apps/web/lib/worker.ts). The worker accepts
it, generates one when it is absent, binds it to every log record emitted
while the request runs, and echoes it on the response. A Railway traceback
can then be tied to the Vercel request that caused it without guessing from
timestamps.

Deliberately a pure-ASGI middleware rather than BaseHTTPMiddleware: the
downstream app runs in the SAME task, so the ContextVar reaches the route
(including sync routes, which run through anyio's threadpool with the
context copied) instead of a task-group copy. It also means an id lands on
the answers that never reach a route at all -- 401s, 404s, validation
errors -- which are exactly the ones worth correlating.

Phase 0 of v0.6 ships the plumbing only. Track C (F-36) decides what the log
FORMAT does with record.request_id and wires Sentry to the same value.
"""
from __future__ import annotations

import logging
import re
import uuid
from contextvars import ContextVar

from fastapi import FastAPI
from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

REQUEST_ID_HEADER = "x-request-id"

# What a log line shows when there is no request: startup, the reaper loop,
# a background job that outlived its response. Never blank, never a fake id.
NO_REQUEST_ID = "-"

# An id we are willing to write back into a response header and into logs.
# The bound and the charset are the point: an upstream caller must not be
# able to inject CRLF into our response headers, ship a non-latin-1 value
# that breaks the header write, or push an unbounded string into every log
# line of the request.
_SAFE_REQUEST_ID = re.compile(r"[A-Za-z0-9._-]{1,128}")

_REQUEST_ID: ContextVar[str | None] = ContextVar("scorer_request_id", default=None)

_record_factory_installed = False


def current_request_id() -> str | None:
    """The id of the request being served here, or None outside one."""
    return _REQUEST_ID.get()


def new_request_id() -> str:
    return str(uuid.uuid4())


def normalize_request_id(value: str | None) -> str | None:
    """An incoming header value, or None when it is not safe to reuse."""
    if value is None:
        return None
    candidate = value.strip()
    return candidate if _SAFE_REQUEST_ID.fullmatch(candidate) else None


def bind_request_id_to_log_records() -> None:
    """Give every LogRecord a request_id attribute, wherever it is created.

    A record factory rather than a filter on purpose: filters only see the
    records that reach the handler they are attached to, so any handler
    added later (Track C's structured handler, pytest's caplog, Sentry's
    breadcrumb handler) would silently lose the field. Installed at most
    once per process -- wrapping twice would stack factories on every
    create_app call.
    """
    global _record_factory_installed
    if _record_factory_installed:
        return
    base_factory = logging.getLogRecordFactory()

    def factory(*args, **kwargs) -> logging.LogRecord:
        record = base_factory(*args, **kwargs)
        record.request_id = current_request_id() or NO_REQUEST_ID
        return record

    logging.setLogRecordFactory(factory)
    _record_factory_installed = True


class RequestIdMiddleware:
    """Bind an id for the duration of the request and echo it on the way out."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        incoming = Headers(scope=scope).get(REQUEST_ID_HEADER)
        request_id = normalize_request_id(incoming) or new_request_id()

        async def send_with_request_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message)[REQUEST_ID_HEADER] = request_id
            await send(message)

        token = _REQUEST_ID.set(request_id)
        try:
            await self.app(scope, receive, send_with_request_id)
        finally:
            _REQUEST_ID.reset(token)


def install_request_id(app: FastAPI) -> None:
    """Wire the middleware and the log binding. One call, in create_app."""
    bind_request_id_to_log_records()
    app.add_middleware(RequestIdMiddleware)
