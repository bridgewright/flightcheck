"""Injection-defence eval suite: does the intake refusal actually work?

F-11b's claim is that a job description which is really an instruction set
is refused rather than compiled. A claim like that is worth exactly as much
as the evidence behind it, so it is gated the same way the judge is: a
committed fixture corpus, a committed baseline, and a suite in the release
gate that fails the release when the defence regresses.

Two numbers, because the defence has two ways to be wrong and they are not
equally expensive:

* **hostile recall** -- the share of instruction sets that are refused. A
  miss leaves fenced text the model will probably still ignore.
* **benign false-positive rate** -- the share of real postings that are
  refused. A false positive tells a paying customer their real posting is
  an attack, which is the failure that loses the customer.

The suite is deliberately DETERMINISTIC: no model call, no API key, no
spend. That is not a shortcut, it is what the defence is -- a classifier at
intake -- and it means this gate runs on every release for free instead of
being something the operator hesitates to run. Its benign corpus is
adversarial on purpose: AI-safety and prompt-engineering postings that
legitimately use the vocabulary of the attack.
"""
from __future__ import annotations

from pathlib import Path

from scorer.promptsafe import classify_injection

HOSTILE = "hostile"
BENIGN = "benign"


def _load(directory: Path) -> list[tuple[str, str]]:
    """(id, text) for every fixture in a label directory, sorted by name."""
    if not directory.is_dir():
        return []
    return [(path.name, path.read_text()) for path in sorted(directory.glob("*.md"))]


def run_injection_suite(suite_dir: Path) -> dict | None:
    """Classify every fixture; None when the suite has no fixtures at all.

    None (rather than an empty pass) is what lets the gate report SKIPPED,
    following the house rule that an absent suite is visible rather than
    silently green.
    """
    fixtures = suite_dir / "fixtures"
    hostile = _load(fixtures / HOSTILE)
    benign = _load(fixtures / BENIGN)
    if not hostile and not benign:
        return None

    misses: list[str] = []
    false_positives: list[str] = []
    for name, text in hostile:
        if not classify_injection(text).refused:
            misses.append(name)
    for name, text in benign:
        verdict = classify_injection(text)
        if verdict.refused:
            false_positives.append(f"{name} ({','.join(verdict.signals)})")

    hostile_total = len(hostile)
    benign_total = len(benign)
    return {
        "hostile_total": hostile_total,
        "hostile_refused": hostile_total - len(misses),
        "hostile_recall": (
            (hostile_total - len(misses)) / hostile_total if hostile_total else 0.0
        ),
        "benign_total": benign_total,
        "benign_refused": len(false_positives),
        "benign_false_positive_rate": (
            len(false_positives) / benign_total if benign_total else 0.0
        ),
        # Named, so a regression report says WHICH fixture moved rather than
        # only that a ratio changed.
        "misses": misses,
        "false_positives": false_positives,
    }
