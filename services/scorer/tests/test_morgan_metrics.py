"""Morgan-side naturalness metrics and their cache-aware CLI."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from pydantic import ValidationError

from scorer.delivery import dsp, morgan_cli
from scorer.delivery.morgan import (
    DSP_CONSTANTS_VERSION,
    MIN_OVERLAP_S,
    MeasurementProvenance,
    MorganMetricsDoc,
    compute_morgan_metrics,
    interviewer_turns,
    invert_speakers,
    morgan_interruptions,
    morgan_response_latencies,
    talk_time_ratio,
    turn_stats,
)
from scorer.schemas import TranscriptSegment

SR = 16000


def _seg(start: float, end: float, speaker: str, text: str = "") -> TranscriptSegment:
    return TranscriptSegment(start_s=start, end_s=end, speaker=speaker, text=text)


def _wav(path: Path, duration_s: float = 2.0) -> None:
    samples = np.zeros(int(SR * duration_s), dtype=np.float32)
    t = np.arange(samples.size) / SR
    samples[:] = 0.25 * np.sin(2 * np.pi * 220 * t)
    sf.write(path, samples, SR)


def test_invert_speakers_round_trip_preserves_order_and_values():
    segments = [_seg(2, 3, "candidate", "answer"), _seg(0, 1, "interviewer", "question")]

    inverted = invert_speakers(segments)

    assert [segment.speaker for segment in inverted] == ["interviewer", "candidate"]
    assert invert_speakers(inverted) == segments
    assert inverted is not segments


def test_talk_time_ratio_handles_overlap_and_zero_speech():
    segments = [_seg(0, 4, "interviewer"), _seg(3, 9, "candidate")]

    assert talk_time_ratio(segments) == pytest.approx(0.4)
    assert talk_time_ratio([]) == 0.0
    assert talk_time_ratio([_seg(1, 1, "interviewer")]) == 0.0


def test_interviewer_turns_join_adjacent_segments_and_candidate_splits_turns():
    segments = [
        _seg(8, 9, "interviewer", "Third?"),
        _seg(0, 1, "interviewer", "First"),
        _seg(1, 3, "interviewer", "second?"),
        _seg(4, 7, "candidate", "answer"),
    ]

    turns = interviewer_turns(segments)

    assert [[segment.text for segment in turn] for turn in turns] == [
        ["First", "second?"],
        ["Third?"],
    ]


def test_turn_stats_count_questions_and_durations():
    segments = [
        _seg(0, 1, "interviewer", "Why?"),
        _seg(1, 4, "interviewer", "And how?"),
        _seg(5, 6, "candidate", "Because."),
        _seg(7, 9, "interviewer", "What next?"),
    ]

    stats = turn_stats(segments)

    assert stats.turn_count == 2
    assert stats.turn_length_mean_s == 3.0
    assert stats.turn_length_p50_s == 3.0
    assert stats.turn_length_max_s == 4.0
    assert stats.questions_per_turn_mean == 1.5
    assert stats.multi_question_turn_count == 1
    assert turn_stats([]).model_dump() == {
        "turn_count": 0,
        "turn_length_mean_s": 0.0,
        "turn_length_p50_s": 0.0,
        "turn_length_max_s": 0.0,
        "questions_per_turn_mean": 0.0,
        "multi_question_turn_count": 0,
    }


def test_interruptions_apply_floor_and_sum_every_overlapping_pair():
    segments = [
        _seg(0, 4, "candidate"),
        _seg(2, 3, "interviewer"),  # 1.0 s: counts
        _seg(3.8, 4.2, "interviewer"),  # 0.2 s: timestamp jitter
        _seg(5, 8, "candidate"),
        _seg(6, 6.3, "interviewer"),  # exactly 0.3 s: counts
    ]

    count, overlap = morgan_interruptions(segments)

    assert count == 2
    assert overlap == pytest.approx(1.5)  # the jitter pair still overlapped


def test_overlap_total_counts_candidate_barge_in_that_is_not_an_interruption():
    """Double-talk the candidate started is echo evidence, not Morgan's fault."""
    segments = [_seg(0, 4, "interviewer"), _seg(2, 6, "candidate")]

    count, overlap = morgan_interruptions(segments)

    assert count == 0
    assert overlap == pytest.approx(2.0)


def test_response_latencies_use_direct_transitions_and_exclude_negatives():
    segments = [
        _seg(0, 2, "candidate"),
        _seg(3, 4, "interviewer"),  # 1.0
        _seg(5, 8, "candidate"),
        _seg(7, 9, "interviewer"),  # -1.0 excluded
        _seg(10, 11, "candidate"),
        _seg(11.5, 12, "candidate"),  # not a direct role transition
        _seg(14, 15, "interviewer"),  # 2.0
    ]

    assert morgan_response_latencies(segments) == [1.0, 2.0]


def test_compute_morgan_metrics_on_synthetic_wav(tmp_path):
    wav = tmp_path / "sample.wav"
    _wav(wav, 4.0)
    segments = [
        _seg(0, 1, "interviewer", "Um why? And what?"),
        _seg(1.5, 3, "candidate", "An answer"),
        _seg(3.5, 4, "interviewer", "Thanks."),
    ]

    doc = compute_morgan_metrics(wav, segments)

    assert doc.case_id == "sample"
    assert doc.source == "morgan"
    assert len(doc.audio_sha256) == 64
    assert doc.duration_s == pytest.approx(4.0)
    assert doc.measurement == MeasurementProvenance(
        transcription_model="gemini-2.5-flash",
        dsp_constants_version="2026-08-08",
        min_overlap_s=MIN_OVERLAP_S,
        transcript_source="fresh",
    )
    assert doc.metrics.talk_time_ratio == pytest.approx(0.5)
    assert doc.metrics.morgan_speaking_s == 1.5
    assert doc.metrics.candidate_speaking_s == 1.5
    assert doc.metrics.turn_count == 2
    assert doc.metrics.multi_question_turn_count == 1
    assert doc.metrics.response_latency_s.mean == pytest.approx(0.5)
    assert doc.metrics.response_latency_s.p90 == pytest.approx(0.5)
    assert doc.metrics.morgan_wpm_overall == pytest.approx(200.0)
    assert doc.metrics.morgan_filler_rate_per_min == pytest.approx(40.0)
    assert doc.metrics.morgan_f0_variance is not None
    assert "text" not in doc.model_dump_json()


def test_metrics_document_requires_measurement_provenance(tmp_path):
    wav = tmp_path / "sample.wav"
    _wav(wav)
    payload = compute_morgan_metrics(wav, []).model_dump()
    payload.pop("measurement")

    with pytest.raises(ValidationError):
        MorganMetricsDoc.model_validate(payload)


def test_dsp_constants_version_pins_segmentation_inputs():
    expected = {
        "_SILENCE_RMS_RATIO": 0.02,
        "_MIN_SILENCE_S": 1.0,
        "_RMS_FRAME_LENGTH": 2048,
        "_RMS_HOP_LENGTH": 512,
        "_PYIN_FMIN_HZ": 65.0,
        "_PYIN_FMAX_HZ": 400.0,
    }
    actual = {name: getattr(dsp, name) for name in expected}

    assert DSP_CONSTANTS_VERSION == "2026-08-08"
    assert actual == expected, (
        "constants changed → bump DSP_CONSTANTS_VERSION and update these pins"
    )


def test_latency_percentiles_interpolate_over_small_samples(tmp_path):
    wav = tmp_path / "sample.wav"
    _wav(wav, 8.0)
    segments = [
        _seg(0, 1, "candidate", "one"),
        _seg(1.5, 2, "interviewer", "Next?"),  # 0.5
        _seg(2.5, 3, "candidate", "two"),
        _seg(4, 4.5, "interviewer", "And?"),  # 1.0
        _seg(5, 5.5, "candidate", "three"),
        _seg(7.5, 8, "interviewer", "Last?"),  # 2.0
    ]

    latency = compute_morgan_metrics(wav, segments).metrics.response_latency_s

    # Linear interpolation between the two highest of three samples.
    assert latency.mean == pytest.approx(3.5 / 3)
    assert latency.p90 == pytest.approx(1.8)


def test_cli_reuses_transcript_cache_without_constructing_client(tmp_path, monkeypatch, capsys):
    suite = tmp_path / "suite"
    out = tmp_path / "out"
    suite.mkdir()
    wav = suite / "clip.wav"
    _wav(wav)
    (suite / "cases.json").write_text(
        json.dumps({"cases": [{"id": "s014", "audio": "clip.wav"}]}),
        encoding="utf-8",
    )
    calls = {"transcribe": 0, "client": 0}

    def fake_client():
        calls["client"] += 1
        return object()

    def fake_transcribe(_audio, _client):
        calls["transcribe"] += 1
        return [_seg(0, 0.5, "interviewer", "Hello?"), _seg(1, 2, "candidate", "Hi")]

    monkeypatch.setattr(morgan_cli, "_make_client", fake_client)
    monkeypatch.setattr(morgan_cli, "transcribe_verbatim", fake_transcribe)

    assert morgan_cli.main(["--suite", str(suite), "--out", str(out)]) == 0
    assert calls == {"transcribe": 1, "client": 1}
    assert morgan_cli.main(["--suite", str(suite), "--out", str(out)]) == 0
    assert calls == {"transcribe": 1, "client": 1}
    written = json.loads((out / "s014.metrics.json").read_text(encoding="utf-8"))
    assert written["case_id"] == "s014"
    assert written["segments_path"].startswith("transcripts/s014.")
    assert written["measurement"]["transcript_source"] == "cache"
    assert written["measurement"]["transcription_model"] == "gemini-2.5-flash"
    assert "text" not in json.dumps(written)
    assert "s014" in capsys.readouterr().out


def test_cli_marks_forced_transcription_fresh(tmp_path, monkeypatch):
    suite = tmp_path / "suite"
    out = tmp_path / "out"
    suite.mkdir()
    _wav(suite / "clip.wav")
    (suite / "cases.json").write_text(
        json.dumps({"cases": [{"id": "s014", "audio": "clip.wav"}]}),
        encoding="utf-8",
    )
    monkeypatch.setattr(morgan_cli, "_make_client", lambda: object())
    monkeypatch.setattr(
        morgan_cli,
        "transcribe_verbatim",
        lambda _audio, _client: [_seg(0, 1, "interviewer", "Hello?")],
    )

    assert morgan_cli.main(["--suite", str(suite), "--out", str(out)]) == 0
    written = json.loads((out / "s014.metrics.json").read_text(encoding="utf-8"))

    assert written["measurement"]["transcript_source"] == "fresh"


def test_cli_carries_each_case_source_into_its_metrics_document(tmp_path, monkeypatch):
    suite = tmp_path / "suite"
    out = tmp_path / "out"
    suite.mkdir()
    _wav(suite / "clip.wav")
    (suite / "cases.json").write_text(
        json.dumps(
            {
                "cases": [
                    {"id": "ref01", "audio": "clip.wav", "source": "reference_avm"},
                    {"id": "s014", "audio": "clip.wav"},
                ]
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(morgan_cli, "_make_client", lambda: object())
    monkeypatch.setattr(
        morgan_cli,
        "transcribe_verbatim",
        lambda _audio, _client: [
            _seg(0, 0.5, "interviewer", "Hello?"),
            _seg(1, 2, "candidate", "Hi"),
        ],
    )

    assert morgan_cli.main(["--suite", str(suite), "--out", str(out)]) == 0

    def _source(case_id: str) -> str:
        return json.loads((out / f"{case_id}.metrics.json").read_text(encoding="utf-8"))[
            "source"
        ]

    assert _source("ref01") == "reference_avm"
    assert _source("s014") == "morgan"


def test_cli_skips_absent_audio(tmp_path, capsys):
    suite = tmp_path / "suite"
    suite.mkdir()
    (suite / "cases.json").write_text(
        json.dumps({"cases": [{"id": "missing", "audio": "none.wav"}]}),
        encoding="utf-8",
    )

    assert morgan_cli.main(["--suite", str(suite), "--out", str(tmp_path / "out")]) == 0
    assert "SKIPPED missing" in capsys.readouterr().out


def test_cli_defaults_resolve_from_scorer_directory():
    args = morgan_cli._parse_args([])

    repo_root = Path(__file__).resolve().parents[3]

    assert args.suite.resolve() == repo_root / "evals/suites/morgan_naturalness"
    assert args.out.resolve() == repo_root / "evals/out/morgan_naturalness"
