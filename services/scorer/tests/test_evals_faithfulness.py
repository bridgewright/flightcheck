"""The rubric-faithfulness suite (F-62) and its place in the release gate.

Unlike the injection suite, the thing under test here costs a live compile
in production -- so these tests are hermetic on purpose: FakeGenAI serves
canned rubric JSON whose jd_evidence values are quoted verbatim from the
committed jd.md fixtures. Faithful canned rubrics flow through the real
compile_rubric; unfaithful ones cannot (the compiler now blocks those
shapes upstream, which is the feature working), so the tests that need one
simulate a regressed compiler via _regressed_compiler instead -- the exact
failure the runner's checks exist to catch.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import scorer.evals_faithfulness as evals_faithfulness
from fakes import FakeGenAI
from scorer.config import load_product_config
from scorer.evals_faithfulness import run_faithfulness_suite
from scorer.evals_l3.regression import REPO_ROOT, evaluate, main
from scorer.schemas import ResearchFindings, Rubric

SUITE_DIR = REPO_ROOT / "evals" / "suites" / "rubric_faithfulness"
BASELINES = json.loads((REPO_ROOT / "evals" / "baselines.json").read_text())

FIXTURE_NAMES = ["ai-safety-genuine", "plain-control", "values-boilerplate-fdpm"]

_CITATION = {
    "url": "https://interview-notes.example/generic",
    "title": "Interview notes",
    "snippet": "what interviewers probe for this role",
}


def _dim(key: str, name: str, channel: str, weight: float,
         jd_evidence: str | None = None) -> dict:
    return {
        "key": key,
        "name": name,
        "weight": weight,
        "channel": channel,
        "anchors": [
            {"score": 1, "behavior": "Vague claims, no concrete example."},
            {"score": 3, "behavior": "One concrete example, thin detail."},
            {"score": 5, "behavior": "Specific and quantified, unprompted."},
        ],
        "signals": ["named specifics"],
        "citations": [_CITATION],
        "jd_evidence": jd_evidence,
    }


def _safety_rubric() -> dict:
    """A faithful compile of ai-safety-genuine: every jd_evidence value is a
    verbatim single-line slice of that fixture's committed jd.md."""
    return {
        "role_title": "Product Manager, Safety Evaluations",
        "company": "Windrose Research",
        "dimensions": [
            _dim("safety-eval-ownership", "Safety evaluation suite ownership",
                 "content", 0.25,
                 "Own the roadmap for the safety evaluation suite: red-teaming harnesses,"),
            _dim("red-teaming-program-design", "Red-teaming program design",
                 "content", 0.2,
                 "Design red-teaming programs with our customers' safety teams"),
            _dim("policy-translation", "Policy to requirements translation",
                 "content", 0.2,
                 "Translate responsible-AI policy requirements, including regulatory"),
            _dim("backlog-prioritization", "Backlog prioritization under pressure",
                 "content", 0.2,
                 "Prioritize the eval backlog against customer model-release deadlines."),
            _dim("spoken-clarity", "Spoken clarity under questioning",
                 "delivery", 0.15),
        ],
        "question_bank": [],
        "research_summary": "Canned rubric for the faithfulness suite tests.",
    }


def _control_rubric() -> dict:
    """A faithful compile of plain-control."""
    return {
        "role_title": "Senior Product Analyst",
        "company": "Harbor Lane Logistics",
        "dimensions": [
            _dim("growth-analytics-ownership", "Growth analytics ownership",
                 "content", 0.3,
                 "Own growth analytics for the booking platform"),
            _dim("experiment-design", "Experiment design and analysis",
                 "content", 0.25,
                 "Design and analyze experiments on pricing and carrier matching."),
            _dim("dashboard-craft", "Dashboard craft", "content", 0.2,
                 "Build and maintain the dashboards operations managers use daily."),
            _dim("stakeholder-communication", "Stakeholder communication",
                 "content", 0.15,
                 "Present findings to non-technical stakeholders and defend the method."),
            _dim("pacing-control", "Pacing control", "delivery", 0.1),
        ],
        "question_bank": [],
        "research_summary": "Canned rubric for the faithfulness suite tests.",
    }


def _fdpm_rubric() -> dict:
    """A faithful compile of values-boilerplate-fdpm: nothing from the
    About-section boilerplate, nothing from the salted findings."""
    return {
        "role_title": "Forward Deployed Product Manager",
        "company": "Meridian Flow",
        "dimensions": [
            _dim("deployment-ownership", "Enterprise deployment ownership",
                 "content", 0.3,
                 "owning the rollout from first workshop to steady state."),
            _dim("field-discovery", "Field discovery into product direction",
                 "content", 0.25,
                 "Run discovery with operations leads and translate what you find into"),
            _dim("stakeholder-influence", "VP-level stakeholder influence",
                 "content", 0.2,
                 "Comfort presenting to VP-level stakeholders and running a room of"),
            _dim("deployment-metrics", "Deployment metrics ownership",
                 "content", 0.15,
                 "Own the deployment metrics for your accounts: time to first automated"),
            _dim("composure-in-the-room", "Composure in the room", "delivery", 0.1),
        ],
        "question_bank": [],
        "research_summary": "Canned rubric for the faithfulness suite tests.",
    }


def _fake_for(safety: dict | None = None, control: dict | None = None,
              fdpm: dict | None = None,
              control_script: list[str] | None = None) -> FakeGenAI:
    """One keyed reply per fixture. The key is the company name, which appears
    in exactly one fixture's fenced JD, so replies cannot cross wires no
    matter which order the runner visits the fixture dirs in."""
    return FakeGenAI(keyed_texts={
        "Windrose Research": [json.dumps(safety or _safety_rubric())],
        "Harbor Lane": control_script or [json.dumps(control or _control_rubric())],
        "Meridian Flow": [json.dumps(fdpm or _fdpm_rubric())],
    })


def _regressed_compiler(monkeypatch, safety: dict | None = None,
                        control: dict | None = None,
                        fdpm: dict | None = None,
                        single: dict | None = None) -> None:
    """Simulate a REGRESSED compiler that emits the crafted rubric verbatim.

    The runner's checks exist to catch exactly this: a compiler whose own
    enforcement broke. On the merged tree the real compile_rubric blocks
    these shapes upstream (missing or non-slice evidence and an oversized
    delivery band burn its repair retry, then raise RubricCompileError; a
    whitespace variant is salvaged to the exact slice), so the unfaithful
    output these tests need can no longer be produced through the real
    compiler -- which is the feature working. Bypassing it is not a
    convenience: it is the regression, simulated precisely.
    """
    rubrics = {
        "Windrose Research": safety or _safety_rubric(),
        "Harbor Lane": control or _control_rubric(),
        "Meridian Flow": fdpm or _fdpm_rubric(),
    }

    def fake_compile(jd_text, profile, findings, corpus, fewshots, client):
        if single is not None:
            return Rubric.model_validate(single)
        for key, doc in rubrics.items():
            if key in jd_text:
                return Rubric.model_validate(doc)
        raise AssertionError("no canned rubric matches this JD")

    monkeypatch.setattr(evals_faithfulness, "compile_rubric", fake_compile)


class TestTheCommittedCorpus:
    def test_the_three_fixture_dirs_are_complete_and_parse(self):
        fixtures = sorted(p for p in (SUITE_DIR / "fixtures").iterdir() if p.is_dir())
        assert [p.name for p in fixtures] == FIXTURE_NAMES
        for fixture_dir in fixtures:
            jd = (fixture_dir / "jd.md").read_text()
            assert jd.strip(), f"{fixture_dir.name}: jd.md is empty"
            findings = ResearchFindings.model_validate_json(
                (fixture_dir / "findings.json").read_text())
            assert findings.citations, f"{fixture_dir.name}: findings carry no citations"
            expectations = json.loads((fixture_dir / "expectations.json").read_text())
            for key in ("forbidden_topics", "required_topics",
                        "delivery_dims_min", "delivery_dims_max"):
                assert key in expectations, f"{fixture_dir.name}: missing {key}"
            assert isinstance(expectations["forbidden_topics"], list)
            assert expectations["required_topics"], (
                f"{fixture_dir.name}: a fixture with nothing required checks nothing"
            )
            for pattern in (expectations["forbidden_topics"]
                            + expectations["required_topics"]):
                re.compile(pattern)  # every expectation is a valid regex
            assert 1 <= expectations["delivery_dims_min"] <= expectations["delivery_dims_max"]


class TestTheRunner:
    def test_a_clean_compile_passes_every_check_on_the_committed_fixtures(self):
        fake = _fake_for()

        result = run_faithfulness_suite(SUITE_DIR, fake)

        assert result is not None
        assert result["fixtures_total"] == 3
        assert result["fixtures_passed"] == 3
        assert result["pass_rate"] == 1.0
        assert result["failures"] == []
        assert sorted(result["fixtures"]) == FIXTURE_NAMES
        for name in FIXTURE_NAMES:
            fixture = result["fixtures"][name]
            assert fixture["status"] == "PASS"
            assert fixture["problems"] == []
            for dim in fixture["dimensions"]:
                assert set(dim) == {"key", "channel", "weight", "has_jd_evidence"}
                if dim["channel"] == "content":
                    assert dim["has_jd_evidence"] is True
        # ONE compile call per fixture: the compiler's internal repair retry
        # is the only smoothing mechanism, and none was needed here.
        assert len(fake.calls) == 3

    def test_an_ethics_dimension_fails_the_pathological_fixture_named(self):
        # The production failure of 2026-08-04, replayed: an ethics dimension
        # whose only JD evidence is About-section boilerplate. The quote IS a
        # verbatim JD slice, so the machinery check passes and the behavior
        # check is what has to catch it.
        fdpm = _fdpm_rubric()
        fdpm["dimensions"][3] = _dim(
            "ethical-judgment", "Ethical judgment", "content", 0.15,
            "ethical AI that benefits everyone")
        fake = _fake_for(fdpm=fdpm)

        result = run_faithfulness_suite(SUITE_DIR, fake)

        assert result["fixtures_passed"] == 2
        assert result["pass_rate"] == 2 / 3
        assert result["fixtures"]["values-boilerplate-fdpm"]["status"] == "FAIL"
        assert ("values-boilerplate-fdpm: forbidden topic 'ethic' matched "
                "dimension 'ethical-judgment' (content)") in result["failures"]
        assert result["fixtures"]["plain-control"]["status"] == "PASS"
        assert result["fixtures"]["ai-safety-genuine"]["status"] == "PASS"

    def test_a_forbidden_topic_in_the_delivery_channel_also_fails(self):
        # The expectation reads "no dimension in EITHER channel": an ethics
        # dimension does not become licensed by relabeling it delivery.
        fdpm = _fdpm_rubric()
        fdpm["dimensions"][4] = _dim(
            "mission-driven-presence", "Mission-driven presence", "delivery", 0.1)
        fake = _fake_for(fdpm=fdpm)

        result = run_faithfulness_suite(SUITE_DIR, fake)

        assert ("values-boilerplate-fdpm: forbidden topic 'mission' matched "
                "dimension 'mission-driven-presence' (delivery)") in result["failures"]

    def test_a_forbidden_topic_hiding_in_the_name_alone_is_still_caught(self):
        # The scan label is key plus name: a dimension whose key is scrubbed
        # clean but whose display name says "Mission alignment" is exactly as
        # unlicensed as one that admits it in the key. Before this test the
        # name half of the label could be dropped without a single failure.
        fdpm = _fdpm_rubric()
        fdpm["dimensions"][3] = _dim(
            "account-fit", "Mission alignment", "content", 0.15,
            "Own the deployment metrics for your accounts: time to first automated")
        fake = _fake_for(fdpm=fdpm)

        result = run_faithfulness_suite(SUITE_DIR, fake)

        assert ("values-boilerplate-fdpm: forbidden topic 'mission' matched "
                "dimension 'account-fit' (content)") in result["failures"]

    def test_missing_jd_evidence_on_a_content_dimension_is_a_machinery_failure(
            self, monkeypatch):
        control = _control_rubric()
        control["dimensions"][0]["jd_evidence"] = None
        _regressed_compiler(monkeypatch, control=control)

        result = run_faithfulness_suite(SUITE_DIR, FakeGenAI([]))

        assert result["fixtures_passed"] == 2
        assert ("plain-control: content dimension 'growth-analytics-ownership' "
                "has no jd_evidence") in result["failures"]
        dims = {dim["key"]: dim
                for dim in result["fixtures"]["plain-control"]["dimensions"]}
        assert dims["growth-analytics-ownership"]["has_jd_evidence"] is False

    def test_empty_string_jd_evidence_is_missing_not_a_trivial_match(
            self, monkeypatch):
        # "" is a substring of every haystack: if the presence check tested
        # `is None` instead of falsiness, a compiler emitting an empty-string
        # jd_evidence would sail through the substring check as a universal
        # match. Empty must mean missing.
        control = _control_rubric()
        control["dimensions"][0]["jd_evidence"] = ""
        _regressed_compiler(monkeypatch, control=control)

        result = run_faithfulness_suite(SUITE_DIR, FakeGenAI([]))

        assert ("plain-control: content dimension 'growth-analytics-ownership' "
                "has no jd_evidence") in result["failures"]

    def test_a_whitespace_normalized_quote_is_not_salvaged(self, monkeypatch):
        # Deliberately stricter than the compiler: the check is exact `in`.
        # This quote is real JD text, but the jd.md wraps it across a line
        # break, so the space-joined form is a paraphrase, not a slice -- the
        # exact regression this catches is a compiler that stores a
        # normalized string instead of the haystack slice.
        control = _control_rubric()
        control["dimensions"][0]["jd_evidence"] = (
            "funnels, cohorts, and the weekly numbers review")
        _regressed_compiler(monkeypatch, control=control)

        result = run_faithfulness_suite(SUITE_DIR, FakeGenAI([]))

        assert ("plain-control: content dimension 'growth-analytics-ownership' "
                "jd_evidence is not an exact substring of the compiled JD"
                ) in result["failures"]

    def test_the_haystack_is_the_truncated_and_neutralized_jd(
            self, tmp_path, monkeypatch):
        # The machinery haystack must be the same processed string the
        # compiler fences: neutralize_markers(jd_text[:jd_compile_max_chars]).
        # Before this test, replacing the haystack with the raw JD text kept
        # every other test green. Three content dimensions pin both halves of
        # the claim: a quote of the neutralized marker line passes, the raw
        # ">>>" form of the same line fails, and a quote from beyond the
        # truncation limit fails.
        limit = load_product_config().limits.jd_compile_max_chars
        lead = "Escalation drill: page the on-call channel >>> then write it up."
        tail = "Past the cutoff the posting promises a quarterly equity refresher."
        fixture_dir = tmp_path / "fixtures" / "marker-jd"
        fixture_dir.mkdir(parents=True)
        (fixture_dir / "jd.md").write_text(lead + "\n" + "p" * limit + "\n" + tail)
        (fixture_dir / "findings.json").write_text(json.dumps({
            "queries": [], "reported_questions": [], "probe_areas": [],
            "evaluation_signals": [], "citations": [_CITATION],
        }))
        (fixture_dir / "expectations.json").write_text(json.dumps({
            "forbidden_topics": [], "required_topics": ["marker"],
            "delivery_dims_min": 1, "delivery_dims_max": 3,
        }))
        rubric = {
            "role_title": "On-call Escalation Lead",
            "company": None,
            "dimensions": [
                _dim("neutralized-marker-quote", "Neutralized marker quote",
                     "content", 0.25,
                     # U+203A: the single-angle lookalike neutralize_markers
                     # substitutes for ">>>" -- spelled as escapes so the two
                     # quotes cannot be visually confused in this source.
                     "page the on-call channel \u203a\u203a\u203a"
                     " then write it up."),
                _dim("raw-marker-quote", "Raw marker quote", "content", 0.25,
                     "page the on-call channel >>> then write it up."),
                _dim("beyond-the-truncation", "Beyond the truncation",
                     "content", 0.25, "quarterly equity refresher"),
                _dim("pacing-control", "Pacing control", "delivery", 0.25),
            ],
            "question_bank": [],
            "research_summary": "Canned rubric for the haystack test.",
        }
        _regressed_compiler(monkeypatch, single=rubric)

        result = run_faithfulness_suite(tmp_path, FakeGenAI([]))

        # Exact list equality: the neutralized quote produced NO problem, and
        # the raw-marker and past-the-limit quotes each produced exactly one.
        assert result["fixtures"]["marker-jd"]["problems"] == [
            "content dimension 'raw-marker-quote' jd_evidence is not an "
            "exact substring of the compiled JD",
            "content dimension 'beyond-the-truncation' jd_evidence is not "
            "an exact substring of the compiled JD",
        ]

    def test_a_delivery_count_outside_the_band_is_a_named_failure(
            self, monkeypatch):
        # Every committed fixture allows 1-3 delivery dimensions and every
        # canned rubric ships exactly 1, so before this test the band check
        # could be deleted without a single failure. Four delivery dimensions
        # must trip the ceiling, and nothing else about this rubric is wrong.
        fdpm = _fdpm_rubric()
        for dim in fdpm["dimensions"][1:4]:
            dim["channel"] = "delivery"
        _regressed_compiler(monkeypatch, fdpm=fdpm)

        result = run_faithfulness_suite(SUITE_DIR, FakeGenAI([]))

        assert result["fixtures"]["values-boilerplate-fdpm"]["problems"] == [
            "delivery-channel count 4 outside [1, 3]"
        ]
        assert ("values-boilerplate-fdpm: delivery-channel count 4 outside "
                "[1, 3]") in result["failures"]

    def test_a_rubric_without_a_safety_dimension_fails_required_topics(self):
        safety = _safety_rubric()
        # Same JD quotes, but every key and name scrubbed of the vocabulary
        # the fixture requires ("safety", "red team", "evaluat").
        renames = [
            ("suite-roadmap-ownership", "Suite roadmap ownership"),
            ("program-design", "Program design with customers"),
            ("policy-translation", "Policy to requirements translation"),
            ("backlog-prioritization", "Backlog prioritization under pressure"),
            ("spoken-clarity", "Spoken clarity under questioning"),
        ]
        for dim, (key, name) in zip(safety["dimensions"], renames, strict=True):
            dim["key"], dim["name"] = key, name
        fake = _fake_for(safety=safety)

        result = run_faithfulness_suite(SUITE_DIR, fake)

        assert result["fixtures"]["ai-safety-genuine"]["status"] == "FAIL"
        assert ("ai-safety-genuine: required topic 'safety|red.team|evaluat' "
                "matched no dimension") in result["failures"]

    def test_a_compile_refusal_is_a_named_fixture_failure_not_a_crash(self):
        # The pathological JD is a paying user's JD: the product must compile
        # it WITHOUT the unlicensed dimensions, not refuse it. Two bad
        # replies exhaust compile_rubric's internal repair retry; the runner
        # records the RubricCompileError against the fixture and moves on.
        fake = _fake_for(control_script=["not json", "still not json"])

        result = run_faithfulness_suite(SUITE_DIR, fake)

        assert result["fixtures_total"] == 3
        assert result["fixtures_passed"] == 2
        failed = result["fixtures"]["plain-control"]
        assert failed["status"] == "FAIL"
        assert failed["dimensions"] == []
        assert failed["problems"][0].startswith("compile failed:")
        assert any(entry.startswith("plain-control: compile failed:")
                   for entry in result["failures"])
        # 2 calls for the failing fixture (compile + repair), 1 each for the rest.
        assert len(fake.calls) == 4

    def test_an_absent_or_empty_fixtures_dir_is_none_not_an_empty_pass(self, tmp_path):
        silent = FakeGenAI([])  # would raise IndexError if the runner called it

        assert run_faithfulness_suite(tmp_path, silent) is None

        (tmp_path / "fixtures").mkdir()
        assert run_faithfulness_suite(tmp_path, silent) is None

        # A stray file is not a fixture dir.
        (tmp_path / "fixtures" / "README.md").write_text("not a fixture")
        assert run_faithfulness_suite(tmp_path, silent) is None
        assert silent.calls == []


class TestTheGate:
    def _result(self, passed: int, failures: list[str]) -> dict:
        return {
            "fixtures_total": 3,
            "fixtures_passed": passed,
            "pass_rate": passed / 3,
            "failures": failures,
            "fixtures": {},
        }

    def test_an_absent_suite_is_skipped_not_passing(self):
        doc, exit_code = evaluate(None, None, BASELINES)

        suite = doc["suites"]["rubric_faithfulness"]
        assert suite["status"] == "SKIPPED"
        assert "rubric_faithfulness/fixtures" in suite["reason"]
        assert exit_code == 0

    def test_a_clean_run_passes(self):
        doc, exit_code = evaluate(
            None, None, BASELINES, faithfulness_result=self._result(3, []))

        suite = doc["suites"]["rubric_faithfulness"]
        assert suite["status"] == "PASS"
        assert suite["pass_rate"] == 1.0
        assert suite["baseline"] == 1.0
        assert exit_code == 0

    def test_one_unfaithful_fixture_fails_the_release(self):
        # The baseline is 1.0: with three fixtures there is no room for one
        # of them to grow an unlicensed dimension.
        failures = ["values-boilerplate-fdpm: forbidden topic 'ethic' matched "
                    "dimension 'ethical-judgment' (content)"]
        doc, exit_code = evaluate(
            None, None, BASELINES, faithfulness_result=self._result(2, failures))

        suite = doc["suites"]["rubric_faithfulness"]
        assert suite["status"] == "FAIL"
        assert suite["failures"] == failures  # named, per the house rule
        assert exit_code == 1

    def test_main_probes_fixtures_and_writes_the_suite_output(self, tmp_path, monkeypatch):
        # Hermetic wiring test: the fixture probe fires, the (stubbed) runner
        # receives the suite dir and a client, and both output files land.
        (tmp_path / "baselines.json").write_text(json.dumps(BASELINES))
        fixture_dir = tmp_path / "suites" / "rubric_faithfulness" / "fixtures" / "demo"
        fixture_dir.mkdir(parents=True)
        canned = self._result(3, [])
        seen: dict[str, object] = {}

        def fake_run(suite_dir: Path, client: object) -> dict:
            seen["suite_dir"] = suite_dir
            seen["client"] = client
            return canned

        monkeypatch.setattr(
            "scorer.evals_l3.regression.run_faithfulness_suite", fake_run)
        monkeypatch.setattr(
            "scorer.evals_l3.regression.require_key", lambda name: "fake-key")
        monkeypatch.setattr(
            "scorer.genai_compat.make_client", lambda key: FakeGenAI([]))

        exit_code = main(["--evals-root", str(tmp_path)])

        assert exit_code == 0
        assert seen["suite_dir"] == tmp_path / "suites" / "rubric_faithfulness"
        assert isinstance(seen["client"], FakeGenAI)
        written = json.loads(
            (tmp_path / "out" / "rubric_faithfulness.json").read_text())
        assert written == canned
        regression = json.loads((tmp_path / "out" / "regression.json").read_text())
        assert regression["suites"]["rubric_faithfulness"]["status"] == "PASS"

    def test_main_skips_a_fixtureless_suite_without_touching_the_key(
            self, tmp_path, monkeypatch):
        # A fixtures dir holding only a stray file is not a runnable suite:
        # main() must report SKIPPED without asking for a GEMINI_API_KEY it
        # will never use and without calling the runner. This is the
        # probe-before-client order, proven hermetically: both are stubbed
        # to explode, so the test holds even on a machine whose environment
        # happens to carry a real key.
        (tmp_path / "baselines.json").write_text(json.dumps(BASELINES))
        fixtures = tmp_path / "suites" / "rubric_faithfulness" / "fixtures"
        fixtures.mkdir(parents=True)
        (fixtures / "README.md").write_text("not a fixture")

        def explode(*args: object, **kwargs: object) -> object:
            raise AssertionError(
                "a fixtureless suite must not reach the key or the runner")

        monkeypatch.setattr(
            "scorer.evals_l3.regression.run_faithfulness_suite", explode)
        monkeypatch.setattr("scorer.evals_l3.regression.require_key", explode)

        exit_code = main(["--evals-root", str(tmp_path)])

        assert exit_code == 0
        written = json.loads((tmp_path / "out" / "regression.json").read_text())
        assert written["suites"]["rubric_faithfulness"]["status"] == "SKIPPED"
        assert not (tmp_path / "out" / "rubric_faithfulness.json").exists()
