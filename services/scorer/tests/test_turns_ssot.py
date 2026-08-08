import json
from pathlib import Path

from scorer.schemas import TranscriptSegment
from scorer.turns import candidate_turns, group_turns


def test_turn_grouping_matches_cross_language_contract():
    path = Path(__file__).resolve().parents[3] / "docs/contracts/turn-grouping.json"
    for case in json.loads(path.read_text())["cases"]:
        segments = [TranscriptSegment.model_validate(item) for item in case["segments"]]
        assert [turn.model_dump() for turn in group_turns(segments)] == (
            case["expected_turns"]
        ), case["name"]
        assert [turn.model_dump() for turn in candidate_turns(segments)] == (
            case["expected_candidate_turns"]
        ), case["name"]
