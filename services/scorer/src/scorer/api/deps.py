"""The collaborators every route needs, in one frozen container.

Before v0.6 the whole route layer lived inside the create_app closure and
simply captured these by lexical scope. That worked, and it also meant every
new endpoint had to be added to the same 640-line function -- three of the
v0.6 tracks add endpoints, so they would have collided on one file.

Deps is that closure's captured state made explicit. create_app is still the
one construction site (nothing else builds a Deps), so the wiring is as
centralized as it was; the difference is that a router module can now be
imported, read, and tested on its own.

Frozen because nothing may swap a collaborator mid-process: the limiters and
counters ARE the rate-limit state, and rebinding one would silently reset
every window. The objects behind the fields are mutable, as they must be.
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from scorer.api.db import Database
from scorer.api.guards import AttemptCounter, FixedWindowLimiter
from scorer.api.storage import Storage
from scorer.config import LimitsConfig
from scorer.schemas import GenAIClientLike


@dataclass(frozen=True)
class Deps:
    """Everything the routers are handed. One instance per app."""

    # The three injected collaborators create_app takes (house pattern: tests
    # exercise the real HTTP surface against fakes, never a transport mock).
    db: Database
    storage: Storage
    client: GenAIClientLike

    # config/product.toml limits, resolved once at app construction.
    limits: LimitsConfig

    # Per-user fixed windows. Keys fall back to the package id for legacy
    # unbound rows so nothing stays uncounted (see guards.py on why
    # process-local is honest here).
    package_create_limiter: FixedWindowLimiter
    session_create_limiter: FixedWindowLimiter
    complete_limiter: FixedWindowLimiter
    feedback_limiter: FixedWindowLimiter
    study_limiter: FixedWindowLimiter

    # Per-row attempt counters behind the F-30 terminal-state transitions.
    resume_attempts: AttemptCounter
    score_attempts: AttemptCounter
    compile_retry_attempts: AttemptCounter

    # The one outbound HTTP call the route layer makes directly (a JD URL the
    # user pasted). Injected like db/storage/client rather than imported by
    # the router, for the same reason: it is a collaborator a test replaces.
    fetch_jd: Callable[[str], str]
