"""Tests for scorer.observability -- logging config and guarded Sentry init."""
import logging
import sys

import sentry_sdk

from scorer.observability import init_sentry, setup_logging


def test_setup_logging_makes_app_info_visible_on_stdout():
    # The F-04 gate logs at INFO and was silently dropped in production
    # (logging never configured). After setup, INFO from any scorer.* logger
    # must reach a stdout handler -- that is what Railway captures.
    setup_logging()
    root = logging.getLogger()
    assert root.level == logging.INFO
    stdout_handlers = [
        handler for handler in root.handlers
        if isinstance(handler, logging.StreamHandler)
        and getattr(handler, "stream", None) is sys.stdout
    ]
    assert stdout_handlers, "no stdout StreamHandler on the root logger"
    assert logging.getLogger("scorer.api.pipeline").isEnabledFor(logging.INFO)


def test_setup_logging_is_idempotent():
    setup_logging()
    setup_logging()
    root = logging.getLogger()
    stdout_handlers = [
        handler for handler in root.handlers
        if isinstance(handler, logging.StreamHandler)
        and getattr(handler, "stream", None) is sys.stdout
    ]
    assert len(stdout_handlers) == 1     # dictConfig replaces, never stacks


def test_init_sentry_is_a_clean_noop_without_a_dsn(monkeypatch, caplog):
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    calls: list[dict] = []
    monkeypatch.setattr(sentry_sdk, "init", lambda **kwargs: calls.append(kwargs))

    with caplog.at_level(logging.WARNING):
        assert init_sentry() is False

    assert calls == []
    assert caplog.records == []          # no warning spam on the happy no-op


def test_init_sentry_initializes_when_the_dsn_is_set(monkeypatch):
    monkeypatch.setenv("SENTRY_DSN", "https://key@example.ingest.sentry.io/1")
    calls: list[dict] = []
    monkeypatch.setattr(sentry_sdk, "init", lambda **kwargs: calls.append(kwargs))

    assert init_sentry() is True

    assert len(calls) == 1
    assert calls[0]["dsn"] == "https://key@example.ingest.sentry.io/1"
    assert calls[0]["send_default_pii"] is False
