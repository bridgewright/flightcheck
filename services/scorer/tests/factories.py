"""Compact row factories for the v0.5 route-contract tests.

Kept out of fakes.py on purpose: fakes.py mirrors production adapters and is
pinned by many suites; these helpers only exist so the new v0.5 test files
can seed packages/sessions without each re-declaring a rubric.
"""
from __future__ import annotations

from fakes import FakeDatabase
from scorer.api.db import PackageRow
from scorer.schemas import (
    BarsAnchor,
    QuestionSpec,
    Rubric,
    RubricDimension,
    SourceCitation,
)


def make_rubric() -> Rubric:
    """Smallest valid rubric: one content + one delivery dimension."""
    def dim(key: str, name: str, channel: str) -> RubricDimension:
        return RubricDimension(
            key=key, name=name, weight=0.5, channel=channel,
            # F-62 faithfulness: a verbatim quote of the JD the compile-retry
            # tests route this rubric through; None on delivery.
            jd_evidence=("Senior Product Analyst" if channel == "content"
                         else None),
            anchors=[
                BarsAnchor(score=1, behavior=f"No sign of {name.lower()}."),
                BarsAnchor(score=3, behavior=f"Some {name.lower()}, thin detail."),
                BarsAnchor(score=5, behavior=f"Consistent, specific {name.lower()}."),
            ],
            signals=[f"{name}: named specifics"],
            citations=[SourceCitation(
                url="https://example.com/guide",
                title="Example guide",
                snippet=f"Interviewers probe {name.lower()}.",
            )],
        )

    return Rubric(
        role_title="Forward Deployed Product Manager",
        company=None,
        dimensions=[
            dim("structured-answers", "Structured answers", "content"),
            dim("pacing-control", "Pacing control", "delivery"),
        ],
        question_bank=[QuestionSpec(
            dimension_key="structured-answers",
            question="Walk me through a project you led end to end.",
            probes=["What was the measurable outcome?"],
            source="generated",
        )],
        research_summary="Synthetic rubric for v0.5 route tests.",
    )


def ready_package(
    db: FakeDatabase,
    *,
    user_id: str | None = "user-1",
    is_trial: bool = False,
    paid_at: str | None = None,
    expires_at: str | None = None,
    total_sessions: int = 6,
) -> PackageRow:
    """A "ready" package in the exact paid/trial/expiry state a test needs."""
    row = db.create_package("We hire a Senior Product Analyst.", None,
                            user_id=user_id)
    db.packages[row.id] = row.model_copy(update={
        "is_trial": is_trial,
        "paid_at": paid_at,
        "expires_at": expires_at,
        "total_sessions": total_sessions,
    })
    db.set_package_rubric(row.id, make_rubric(), status="ready")
    return db.get_package(row.id)
