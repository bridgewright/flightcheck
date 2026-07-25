import numpy as np
import pytest
import soundfile as sf

from scorer.evals_l3.delivery_check import find_triplets


def _write_clip(path):
    sf.write(str(path), np.zeros(8000, dtype=np.float32), 16000)


def test_incomplete_triplet_is_a_visible_error(tmp_path):
    clips_dir = tmp_path / "clips"
    clips_dir.mkdir()
    _write_clip(clips_dir / "q1-fluent.wav")
    with pytest.raises(SystemExit, match="q1"):
        find_triplets(clips_dir)


def test_triplets_discovered_sorted_by_question(tmp_path):
    clips_dir = tmp_path / "clips"
    clips_dir.mkdir()
    for question in ("q2", "q1"):
        for variant in ("fluent", "filler", "hesitant"):
            _write_clip(clips_dir / f"{question}-{variant}.wav")

    triplets = find_triplets(clips_dir)

    assert [question for question, _clips in triplets] == ["q1", "q2"]
    q1_clips = dict(triplets)["q1"]
    assert sorted(q1_clips) == ["filler", "fluent", "hesitant"]
    assert q1_clips["hesitant"].name == "q1-hesitant.wav"
