import numpy as np
import pytest
import soundfile as sf

from fakes import FakeGenAI
from scorer.delivery.dsp import compute_delivery_metrics
from scorer.delivery.judge import DeliveryJudgeError
from scorer.evals_l3 import delivery_check
from scorer.evals_l3.delivery_check import (
    EVAL_DELIVERY_DIMENSION,
    find_triplets,
    run_delivery_discrimination,
)
from scorer.schemas import DeliveryMetrics, DimensionScore, SilenceEvent


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


def _make_clips_dir(tmp_path):
    clips_dir = tmp_path / "clips"
    clips_dir.mkdir()
    for variant in ("fluent", "filler", "hesitant"):
        _write_clip(clips_dir / f"q1-{variant}.wav")
    return clips_dir


def _metrics_with_silences(count: int) -> DeliveryMetrics:
    return DeliveryMetrics(
        wpm_overall=0.0,
        wpm_timeline=[],
        silence_events=[
            SilenceEvent(start_s=float(i), duration_s=1.5) for i in range(count)
        ],
        filler_count=0,
        filler_rate_per_min=0.0,
        f0_variance=None,
        avg_response_latency_s=None,
    )


def _variant_of(path) -> str:
    return path.name.rsplit("-", 1)[1].removesuffix(".wav")


def _install_fakes(monkeypatch, silences_by_variant, judge_score_by_variant):
    def fake_metrics(audio_path, segments):
        # The runner fabricates a zero-length interviewer segment (opens the
        # DSP's candidate silence window) followed by one whole-clip
        # candidate segment.
        assert len(segments) == 2
        assert segments[0].speaker == "interviewer"
        assert segments[0].start_s == segments[0].end_s == 0.0
        assert segments[1].speaker == "candidate"
        return _metrics_with_silences(silences_by_variant[_variant_of(audio_path)])

    def fake_judge(audio_path, metrics, delivery_dims, client):
        assert delivery_dims == [EVAL_DELIVERY_DIMENSION]
        score = judge_score_by_variant[_variant_of(audio_path)]
        return (
            [
                DimensionScore(
                    dimension_key="delivery-fluency",
                    score=score,
                    evidence_quotes=[],
                    rationale="Synthetic eval score.",
                )
            ],
            [],
        )

    monkeypatch.setattr(delivery_check, "compute_delivery_metrics", fake_metrics)
    monkeypatch.setattr(delivery_check, "judge_delivery", fake_judge)


def test_dsp_and_judge_ordering_pass(tmp_path, monkeypatch):
    clips_dir = _make_clips_dir(tmp_path)
    _install_fakes(
        monkeypatch,
        silences_by_variant={"fluent": 0, "filler": 1, "hesitant": 3},
        judge_score_by_variant={"fluent": 4.5, "filler": 3.0, "hesitant": 2.0},
    )

    result = run_delivery_discrimination(clips_dir, FakeGenAI([]))

    assert result == {"triplets": 1, "dsp_pass": 1, "judge_pass": 1, "failures": []}


def test_dsp_and_judge_ordering_failures_are_recorded(tmp_path, monkeypatch):
    clips_dir = _make_clips_dir(tmp_path)
    _install_fakes(
        monkeypatch,
        # DSP fail: fluent does not have strictly fewer silences than hesitant.
        silences_by_variant={"fluent": 2, "filler": 1, "hesitant": 2},
        # Judge fail: fluent ties filler (strict ordering required).
        judge_score_by_variant={"fluent": 3.0, "filler": 3.0, "hesitant": 2.0},
    )

    result = run_delivery_discrimination(clips_dir, FakeGenAI([]))

    assert result["triplets"] == 1
    assert result["dsp_pass"] == 0
    assert result["judge_pass"] == 0
    assert sorted(f["check"] for f in result["failures"]) == ["dsp", "judge"]
    dsp_failure = next(f for f in result["failures"] if f["check"] == "dsp")
    assert dsp_failure["silence_events"] == {"fluent": 2, "filler": 1, "hesitant": 2}
    judge_failure = next(f for f in result["failures"] if f["check"] == "judge")
    assert judge_failure["scores"] == {"fluent": 3.0, "filler": 3.0, "hesitant": 2.0}


def test_fabricated_segments_open_a_real_dsp_silence_window(tmp_path):
    # Real DSP end-to-end (no monkeypatching compute_delivery_metrics): proves
    # the fabricated segments actually open a candidate window against
    # dsp._candidate_windows, which only opens a window BETWEEN two
    # interviewer segments. A fabrication with zero interviewer segments
    # would report silence_events == [] no matter what the audio contains.
    sr = 16000
    duration_s = 4.0
    n_samples = int(duration_s * sr)
    t = np.arange(n_samples) / sr
    tone = (0.5 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
    silence_lo = int(1.0 * sr)
    silence_hi = int(2.2 * sr)  # 1.2s of silence, comfortably over the 1.0s floor
    tone[silence_lo:silence_hi] = 0.0
    path = tmp_path / "with-a-real-gap.wav"
    sf.write(str(path), tone, sr)

    segments = delivery_check._whole_clip_segment(path)
    metrics = compute_delivery_metrics(path, segments)

    assert metrics.silence_events != []


def test_flaky_judge_reply_is_recorded_and_run_continues(tmp_path, monkeypatch):
    # A single unusable judge reply (DeliveryJudgeError) for one triplet is a
    # data point, not the end of the run -- mirrors evals_l1.golden's
    # ContentJudgeError discipline. The other triplet still gets scored.
    clips_dir = tmp_path / "clips"
    clips_dir.mkdir()
    for question in ("q1", "q2"):
        for variant in ("fluent", "filler", "hesitant"):
            _write_clip(clips_dir / f"{question}-{variant}.wav")

    silences_by_variant = {"fluent": 0, "filler": 1, "hesitant": 3}
    judge_score_by_variant = {"fluent": 4.5, "filler": 3.0, "hesitant": 2.0}

    def fake_metrics(audio_path, segments):
        return _metrics_with_silences(silences_by_variant[_variant_of(audio_path)])

    def fake_judge(audio_path, metrics, delivery_dims, client):
        if audio_path.name == "q1-fluent.wav":
            raise DeliveryJudgeError(
                "delivery judge response missing dimensions: ['delivery-fluency']"
            )
        score = judge_score_by_variant[_variant_of(audio_path)]
        return (
            [
                DimensionScore(
                    dimension_key="delivery-fluency",
                    score=score,
                    evidence_quotes=[],
                    rationale="Synthetic eval score.",
                )
            ],
            [],
        )

    monkeypatch.setattr(delivery_check, "compute_delivery_metrics", fake_metrics)
    monkeypatch.setattr(delivery_check, "judge_delivery", fake_judge)

    result = run_delivery_discrimination(clips_dir, FakeGenAI([]))

    assert result["triplets"] == 2
    assert result["dsp_pass"] == 2  # DSP is unaffected by the judge failure
    assert result["judge_pass"] == 1  # only q2 completes the judge check
    q1_failure = next(
        f for f in result["failures"] if f["question"] == "q1" and f["check"] == "judge"
    )
    assert "DeliveryJudgeError" in q1_failure["reason"]
    assert q1_failure["scores"] == {}
