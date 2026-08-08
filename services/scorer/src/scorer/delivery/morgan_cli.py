"""Cache-aware CLI for Morgan naturalness metrics."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
from typing import Any

from scorer.audio_utils import ensure_wav
from scorer.config import load_product_config
from scorer.content.transcribe import transcribe_verbatim
from scorer.delivery.morgan import (
    DSP_CONSTANTS_VERSION,
    MIN_OVERLAP_S,
    MeasurementProvenance,
    compute_morgan_metrics,
)
from scorer.genai_compat import make_client
from scorer.schemas import GenAIClientLike, TranscriptSegment

_SCORER_DIR = Path(__file__).resolve().parents[3]
_DEFAULT_SUITE = _SCORER_DIR / "../../evals/suites/morgan_naturalness"
_DEFAULT_OUT = _SCORER_DIR / "../../evals/out/morgan_naturalness"


def _make_client() -> GenAIClientLike:
    return make_client(os.environ.get("GEMINI_API_KEY", ""))


def _case_value(case: dict[str, Any], *names: str) -> str:
    for name in names:
        value = case.get(name)
        if isinstance(value, str):
            return value
    raise ValueError(f"case is missing one of: {', '.join(names)}")


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suite", type=Path, default=_DEFAULT_SUITE)
    parser.add_argument("--out", type=Path, default=_DEFAULT_OUT)
    parser.add_argument("--case", dest="case_id")
    parser.add_argument("--force-transcribe", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    suite = args.suite.resolve()
    out = args.out.resolve()
    manifest = json.loads((suite / "cases.json").read_text(encoding="utf-8"))
    for case in manifest["cases"]:
        case_id = _case_value(case, "id", "case_id")
        if args.case_id and case_id != args.case_id:
            continue
        audio = suite / _case_value(case, "audio", "audio_path", "path")
        if not audio.is_file():
            print(f"SKIPPED {case_id}: audio file absent")
            continue
        wav = ensure_wav(audio)
        digest = hashlib.sha256(wav.read_bytes()).hexdigest()
        relative_segments = Path("transcripts") / f"{case_id}.{digest[:12]}.segments.json"
        segments_file = out / relative_segments
        if segments_file.is_file() and not args.force_transcribe:
            transcript_source = "cache"
            raw_segments = json.loads(segments_file.read_text(encoding="utf-8"))
            segments = [TranscriptSegment.model_validate(item) for item in raw_segments]
        else:
            transcript_source = "fresh"
            segments = transcribe_verbatim(wav, _make_client())
            segments_file.parent.mkdir(parents=True, exist_ok=True)
            segments_file.write_text(
                json.dumps([segment.model_dump() for segment in segments], indent=2) + "\n",
                encoding="utf-8",
            )
        # The manifest owns `source`: the report splits reference_avm clips
        # into their own table, so a hardcoded "morgan" would leave that
        # section permanently empty.
        source = case.get("source")
        doc = compute_morgan_metrics(wav, segments).model_copy(
            update={
                "case_id": case_id,
                "source": source if isinstance(source, str) else "morgan",
                "segments_path": relative_segments.as_posix(),
                # Keep coupled to transcribe_verbatim, which resolves this same
                # config value internally at the provider call boundary.
                "measurement": MeasurementProvenance(
                    transcription_model=load_product_config().models.scorer,
                    dsp_constants_version=DSP_CONSTANTS_VERSION,
                    min_overlap_s=MIN_OVERLAP_S,
                    transcript_source=transcript_source,
                ),
            }
        )
        out.mkdir(parents=True, exist_ok=True)
        metrics_file = out / f"{case_id}.metrics.json"
        metrics_file.write_text(doc.model_dump_json(indent=2) + "\n", encoding="utf-8")
        print(f"WROTE {case_id}: {metrics_file}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
