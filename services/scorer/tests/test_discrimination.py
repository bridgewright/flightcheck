from pathlib import Path
from scorer.bakeoff.discrimination import rank_clips, Trial, accuracy


class FakeRankerFromTruth:
    name = "oracle"
    def rank(self, labeled, prompt):
        order = {"fluent": 0, "filler": 1, "hesitant": 2}
        return [letter for letter, path in sorted(labeled, key=lambda lp: order[Path(lp[1]).stem])]


def test_rank_clips_marks_correct_when_order_matches_truth(tmp_path):
    clips = {k: tmp_path / f"{k}.wav" for k in ("fluent", "filler", "hesitant")}
    for p in clips.values():
        p.write_bytes(b"")
    # letters are assigned in permutation order; the oracle ranker reconstructs
    # truth from the clip path stems regardless of the assigned letters.
    trial = rank_clips(FakeRankerFromTruth(), clips)
    assert trial.correct


def test_accuracy_aggregates():
    trials = [Trial("m", ("A",), ["A"], True), Trial("m", ("A",), ["A"], False)]
    assert accuracy(trials) == 0.5
