"""F-94 / DECISIONS 077: the peripheral-family governance module.

The classification is deliberately narrow -- the ethics/safety family and
only that family, by whole-word match over a dimension's key and name (the
F-92 fragment-keyword lesson is a standing review lens). The corpus test
runs the classifier over every committed rubric fixture in the repo and
pins positives AND near-miss negatives, so widening or narrowing the family
constant cannot happen silently. The weight cap is conditional on the JD's
own emphasis (the deterministic line-count heuristic), and the
redistribution is property-tested over adversarial weight vectors: the sum
invariant and the cap must hold for every vector that can reach it.
"""
from __future__ import annotations

import json
import random
from pathlib import Path
from typing import ClassVar

from scorer.config import load_product_config
from scorer.evals_l3.regression import REPO_ROOT
from scorer.promptsafe import neutralize_markers
from scorer.rubric.governance import (
    FOREGROUND_LINE_THRESHOLD,
    PERIPHERAL_WEIGHT_CAP,
    apply_governance,
    capped_weights,
    is_peripheral_dimension,
    jd_foregrounds_family,
)
from scorer.schemas import (
    BarsAnchor,
    QuestionSpec,
    Rubric,
    RubricDimension,
    SourceCitation,
)
from scorer.sessionplan.planner import plan_baseline_session

FIXTURES_ROOT = REPO_ROOT / "evals" / "suites" / "rubric_faithfulness" / "fixtures"


def _dim(key: str, name: str, channel: str = "content", weight: float = 0.2,
         license_value: str = "jd") -> RubricDimension:
    return RubricDimension(
        key=key,
        name=name,
        weight=weight,
        channel=channel,
        anchors=[
            BarsAnchor(score=1, behavior="Vague claims, no example."),
            BarsAnchor(score=3, behavior="One example, thin detail."),
            BarsAnchor(score=5, behavior="Specific and quantified."),
        ],
        signals=["named specifics"],
        citations=[SourceCitation(
            url="https://example.com/guide",
            title="Example guide",
            snippet="what interviewers probe",
        )],
        license=license_value,
    )


class TestTheClassifier:
    def test_the_production_dimension_is_peripheral(self):
        # The lived failure: "AI Safety and Mission Alignment", compiled as a
        # front-line dimension on the operator's own home screen.
        dim = _dim("ai-safety-and-mission-alignment",
                   "AI Safety and Mission Alignment")
        assert is_peripheral_dimension(dim)

    def test_each_family_keyword_classifies_on_its_own(self):
        for key, name in [
            ("ethics", "Ethics"),
            ("ethical-judgment", "Ethical judgment"),
            ("ai-safety", "AI safety"),
            ("safety-culture", "Safety culture"),
            ("responsible-ai-deployment", "Responsible AI deployment"),
            ("mission-alignment", "Mission alignment"),
        ]:
            assert is_peripheral_dimension(_dim(key, name)), key

    def test_the_pair_keywords_match_across_space_and_hyphen(self):
        # Real dimension names write both "responsible AI" and
        # "responsible-AI"; the pair must classify either way.
        assert is_peripheral_dimension(_dim("policy", "Responsible-AI policy"))
        assert is_peripheral_dimension(_dim("policy", "Mission-Alignment work"))

    def test_bare_alignment_and_bare_mission_never_classify(self):
        # Stakeholder alignment is a real, legitimate dimension (DECISIONS
        # 077) and a mission statement alone is not the family.
        for key, name in [
            ("stakeholder-alignment", "Stakeholder Alignment"),
            ("mission-driven-presence", "Mission-driven presence"),
            ("cross-team-alignment", "Cross-team alignment"),
            ("company-mission-fluency", "Company mission fluency"),
        ]:
            assert not is_peripheral_dimension(_dim(key, name)), key

    def test_fragments_never_classify(self):
        # Whole-word only: "safe" is not "safety", "missionary" is not
        # "mission alignment", "ethics" hides in no longer word here.
        for key, name in [
            ("fail-safe-design", "Fail-safe design"),
            ("missionary-sales", "Missionary sales"),
            ("aesthetics-review", "Aesthetics review"),
        ]:
            assert not is_peripheral_dimension(_dim(key, name)), key

    def test_the_name_alone_is_enough(self):
        # A scrubbed key with a family name is exactly as peripheral as one
        # that admits it in the key (the eval suite's own lesson).
        assert is_peripheral_dimension(_dim("account-fit", "Mission alignment"))

    def test_pair_keywords_never_match_across_the_key_name_boundary(self):
        # Key and name are separate fields: a key ending in "mission" next
        # to a name starting with "Alignment" is bare "mission" plus bare
        # "alignment" -- exactly what DECISIONS 077 says never classifies.
        # A joined "key name" haystack manufactured both pairs out of
        # fields that are each innocent on their own.
        for key, name in [
            ("company-mission", "Alignment with stakeholders"),
            ("socially-responsible", "AI product judgment"),
        ]:
            assert not is_peripheral_dimension(_dim(key, name)), key

    def test_the_fit_dimension_is_excluded_by_key_and_by_license(self):
        assert not is_peripheral_dimension(
            _dim("role-and-company-fit", "Ethics and company fit"))
        assert not is_peripheral_dimension(
            _dim("values-fit", "Safety values fit", license_value="profile"))

    def test_delivery_channel_dimensions_are_excluded(self):
        assert not is_peripheral_dimension(
            _dim("composed-safety-presence", "Safety presence",
                 channel="delivery"))


class TestTheCommittedCorpus:
    """The classifier over EVERY committed rubric fixture in the repo."""

    # Every committed rubric fixture, with the exact peripheral keys it
    # holds. The discovery test below fails when a new rubric fixture lands
    # without a row here -- the corpus claim stays corpus-wide.
    EXPECTED: ClassVar[dict[str, set[str]]] = {
        "evals/suites/rubric_discrimination/rubric.json": {
            "ai-evaluation-responsible-ai",
        },
    }

    @staticmethod
    def _committed_rubric_fixtures() -> list[Path]:
        roots = [REPO_ROOT / "evals",
                 Path(__file__).parent / "fixtures"]
        found = []
        for root in roots:
            for path in sorted(root.rglob("*.json")):
                try:
                    doc = json.loads(path.read_text())
                except (json.JSONDecodeError, UnicodeDecodeError):
                    continue
                dims = doc.get("dimensions") if isinstance(doc, dict) else None
                if (isinstance(dims, list) and dims
                        and isinstance(dims[0], dict) and "channel" in dims[0]):
                    found.append(path)
        return found

    def test_every_committed_rubric_fixture_is_enumerated(self):
        found = {
            path.relative_to(REPO_ROOT).as_posix()
            if path.is_relative_to(REPO_ROOT)
            else path.name
            for path in self._committed_rubric_fixtures()
        }
        assert found == set(self.EXPECTED), (
            "a rubric fixture joined or left the corpus; update EXPECTED so "
            "the classifier keeps running over every committed rubric")

    def test_the_classifier_over_the_whole_corpus(self):
        for rel_path, expected_keys in self.EXPECTED.items():
            doc = json.loads((REPO_ROOT / rel_path).read_text())
            dims = [RubricDimension.model_validate(entry)
                    for entry in doc["dimensions"]]
            classified = {dim.key for dim in dims
                          if is_peripheral_dimension(dim)}
            assert classified == expected_keys, rel_path

    def test_corpus_near_misses_stay_negative(self):
        # The corpus' own near-miss negatives, pinned individually so a
        # future fixture change cannot blur what "negative" meant.
        doc = json.loads(
            (REPO_ROOT / "evals/suites/rubric_discrimination/rubric.json")
            .read_text())
        dims = {entry["key"]: RubricDimension.model_validate(entry)
                for entry in doc["dimensions"]}
        for key in ("stakeholder-collaboration-communication",
                    "ai-product-strategy-judgment",
                    "end-to-end-ownership"):
            assert not is_peripheral_dimension(dims[key]), key


class TestLegacyStoredRubrics:
    """A rubric stored before probing_mode existed behaves exactly as before.

    DECISIONS 077 rejects retroactive mutation: only the compile path calls
    governance, so a legacy rubric -- even one holding a peripheral-family
    dimension -- parses via the schema default and keeps its front-line
    behavior. The committed discrimination rubric is exactly that shape.
    """

    LEGACY = REPO_ROOT / "evals" / "suites" / "rubric_discrimination" / "rubric.json"

    def test_a_stored_rubric_without_the_field_parses_all_direct(self):
        raw = self.LEGACY.read_text()
        assert "probing_mode" not in raw  # genuinely pre-F-94 storage
        rubric = Rubric.model_validate(json.loads(raw))
        assert all(dim.probing_mode == "direct" for dim in rubric.dimensions)
        assert any(is_peripheral_dimension(dim) for dim in rubric.dimensions)

    def test_a_stored_rubric_plans_exactly_as_before_f94(self):
        # The peripheral dimension keeps its main question and stays
        # eligible for every planner surface -- new compiles only.
        rubric = Rubric.model_validate(json.loads(self.LEGACY.read_text()))
        plan = plan_baseline_session(rubric)
        planned_keys = {q.dimension_key for q in plan.question_sequence}
        assert planned_keys == {dim.key for dim in rubric.dimensions}
        assert "ai-evaluation-responsible-ai" in planned_keys


class TestTheEmphasisHeuristic:
    @staticmethod
    def _jd_as_shown(fixture: str) -> str:
        # Character for character the compiler's own processing.
        limit = load_product_config().limits.jd_compile_max_chars
        jd_text = (FIXTURES_ROOT / fixture / "jd.md").read_text()
        return neutralize_markers(jd_text[:limit])

    def test_a_safety_jd_genuinely_foregrounds_the_family(self):
        assert jd_foregrounds_family(self._jd_as_shown("ai-safety-genuine"))

    def test_boilerplate_and_control_jds_do_not(self):
        for fixture in ("values-boilerplate-fdpm", "plain-control",
                        "consultant-product-pivot"):
            assert not jd_foregrounds_family(self._jd_as_shown(fixture)), fixture

    def test_the_threshold_is_three_distinct_lines(self):
        line = "We take AI safety seriously in this role."
        two = "\n".join([line, "Plain line.", "Safety reviews gate launches."])
        three = two + "\nEthics escalations reach the review board."
        assert FOREGROUND_LINE_THRESHOLD == 3
        assert not jd_foregrounds_family(two)
        assert jd_foregrounds_family(three)

    def test_repeated_identical_lines_count_once(self):
        # "Distinct" is literal: pasting one safety line three times is not
        # a JD that foregrounds the family.
        assert not jd_foregrounds_family(
            "Safety first.\nSafety first.\nSafety first.")


class TestCappedWeights:
    def test_a_peripheral_weight_above_the_cap_is_clamped_and_redistributed(self):
        capped = capped_weights([0.4, 0.35, 0.25], [True, False, False])
        assert capped[0] == PERIPHERAL_WEIGHT_CAP
        # The 0.30 excess spreads proportionally over 0.35 and 0.25.
        assert abs(capped[1] - 0.35 * (1 + 0.3 / 0.6)) < 1e-9
        assert abs(capped[2] - 0.25 * (1 + 0.3 / 0.6)) < 1e-9
        assert abs(sum(capped) - 1.0) < 1e-9

    def test_a_peripheral_weight_at_or_below_the_cap_stands(self):
        weights = [0.1, 0.05, 0.5, 0.35]
        flags = [True, True, False, False]
        assert capped_weights(weights, flags) == weights

    def test_the_all_peripheral_degenerate_case_never_divides_by_zero(self):
        weights = [0.6, 0.4]
        assert capped_weights(weights, [True, True]) == weights

    def test_property_sum_and_cap_hold_over_adversarial_vectors(self):
        # No hypothesis dependency by house rule: a seeded generator over
        # many dims, tiny dims, near-zero remainders, and every flag shape.
        rng = random.Random(94)
        for trial in range(500):
            n = rng.randint(1, 12)
            raw = [rng.choice([rng.random(), rng.random() * 1e-4, 0.0])
                   for _ in range(n)]
            total = sum(raw) or 1.0
            weights = [w / total for w in raw]
            flags = [rng.random() < 0.5 for _ in range(n)]
            capped = capped_weights(weights, flags)
            assert abs(sum(capped) - sum(weights)) < 1e-9, trial
            redistributed = capped != weights
            for original, flag, result in zip(weights, flags, capped,
                                              strict=True):
                if flag and redistributed:
                    assert result <= PERIPHERAL_WEIGHT_CAP + 1e-9, trial
                if not flag:
                    # Non-peripheral weight only ever grows.
                    assert result >= original - 1e-9, trial

    def test_property_non_peripheral_proportions_are_preserved(self):
        rng = random.Random(95)
        for _ in range(200):
            n = rng.randint(2, 10)
            weights = [rng.random() + 1e-6 for _ in range(n)]
            total = sum(weights)
            weights = [w / total for w in weights]
            flags = [i == 0 for i in range(n)]
            capped = capped_weights(weights, flags)
            others = [(w, c) for w, c, f
                      in zip(weights, capped, flags, strict=True) if not f]
            ratios = {round(c / w, 9) for w, c in others}
            assert len(ratios) == 1


def _governable_rubric() -> Rubric:
    return Rubric(
        role_title="Forward Deployed Product Manager",
        company="Meridian Flow",
        dimensions=[
            _dim("deployment-ownership", "Enterprise deployment ownership",
                 weight=0.3),
            _dim("ai-safety-and-mission-alignment",
                 "AI Safety and Mission Alignment", weight=0.25),
            _dim("field-discovery", "Field discovery", weight=0.25),
            _dim("pacing-control", "Pacing control", channel="delivery",
                 weight=0.2),
        ],
        question_bank=[
            QuestionSpec(
                dimension_key="ai-safety-and-mission-alignment",
                question="How do you keep AI deployments safe?",
                probes=["What did you change after a near miss?"],
                source="generated",
            ),
            QuestionSpec(
                dimension_key="deployment-ownership",
                question="Walk me through a rollout you owned end to end.",
                probes=["What was the measurable outcome?"],
                source="generated",
            ),
        ],
        research_summary="Synthetic rubric for governance tests.",
    )


PLAIN_JD = "Deploy the platform.\nOwn the rollout.\nRun discovery on site."
SAFETY_JD = (
    "Own the safety evaluation suite.\n"
    "Design red-teaming programs with safety teams.\n"
    "Translate responsible AI policy into criteria."
)


class TestApplyGovernance:
    def test_peripheral_dimensions_are_always_indirect(self):
        for jd in (PLAIN_JD, SAFETY_JD):
            governed = apply_governance(_governable_rubric(), jd)
            by_key = {dim.key: dim for dim in governed.dimensions}
            assert (by_key["ai-safety-and-mission-alignment"].probing_mode
                    == "indirect"), jd
            assert by_key["deployment-ownership"].probing_mode == "direct"
            assert by_key["field-discovery"].probing_mode == "direct"
            assert by_key["pacing-control"].probing_mode == "direct"

    def test_weight_is_capped_only_when_the_jd_does_not_foreground(self):
        capped = apply_governance(_governable_rubric(), PLAIN_JD)
        by_key = {dim.key: dim for dim in capped.dimensions}
        assert by_key["ai-safety-and-mission-alignment"].weight == (
            PERIPHERAL_WEIGHT_CAP)
        assert abs(sum(d.weight for d in capped.dimensions) - 1.0) < 1e-9
        # The 0.15 excess spreads over the other three, proportionally.
        assert by_key["deployment-ownership"].weight > 0.3

        uncapped = apply_governance(_governable_rubric(), SAFETY_JD)
        by_key = {dim.key: dim for dim in uncapped.dimensions}
        assert by_key["ai-safety-and-mission-alignment"].weight == 0.25

    def test_question_bank_entries_for_indirect_dimensions_are_dropped(self):
        governed = apply_governance(_governable_rubric(), PLAIN_JD)
        keys = [q.dimension_key for q in governed.question_bank]
        assert "ai-safety-and-mission-alignment" not in keys
        assert "deployment-ownership" in keys

    def test_a_rubric_without_peripheral_dimensions_is_returned_unchanged(self):
        rubric = _governable_rubric()
        rubric = rubric.model_copy(update={
            "dimensions": [dim for dim in rubric.dimensions
                           if dim.key != "ai-safety-and-mission-alignment"]
            + [_dim("stakeholder-alignment", "Stakeholder Alignment",
                    weight=0.25)],
        })
        assert apply_governance(rubric, PLAIN_JD) == rubric

    def test_governance_is_idempotent(self):
        once = apply_governance(_governable_rubric(), PLAIN_JD)
        assert apply_governance(once, PLAIN_JD) == once

    def test_the_output_is_a_validated_rubric(self):
        governed = apply_governance(_governable_rubric(), PLAIN_JD)
        assert Rubric.model_validate(governed.model_dump()) == governed
