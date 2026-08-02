"""Tests for scorer.report.eligibility -- the F-04 scoring-eligibility gate."""
from scorer.config import EligibilityConfig
from scorer.report.eligibility import check_eligibility
from scorer.schemas import TranscriptSegment

CFG = EligibilityConfig(
    min_duration_s=600.0,
    min_candidate_turns=5,
    min_candidate_words=200,
    full_duration_s=900.0,
    full_candidate_words=600,
)


def _turns(n_turns: int, words_per_turn: int) -> list[TranscriptSegment]:
    """Alternating interviewer/candidate segments: n_turns candidate turns."""
    segments: list[TranscriptSegment] = []
    at = 0.0
    for i in range(n_turns):
        segments.append(TranscriptSegment(
            start_s=at, end_s=at + 5.0, speaker="interviewer",
            text=f"Question {i + 1}?"))
        at += 6.0
        segments.append(TranscriptSegment(
            start_s=at, end_s=at + 30.0, speaker="candidate",
            text=" ".join(["word"] * words_per_turn)))
        at += 31.0
    return segments


def test_full_session_is_scored():
    assert check_eligibility(_turns(8, 100), 1200.0, CFG) == "scored"


def test_boundary_values_count_as_full():
    # Floors are inclusive: exactly-at-threshold evidence is full evidence.
    assert check_eligibility(_turns(5, 120), 900.0, CFG) == "scored"


def test_mid_length_session_is_limited():
    # 600-900s: scorable, but the report must carry the limited marker.
    assert check_eligibility(_turns(8, 100), 700.0, CFG) == "limited"


def test_thin_content_is_limited_even_in_a_long_session():
    # 5 turns x 50 words = 250: above the 200-word floor, below the
    # 600-word full-evidence bar.
    assert check_eligibility(_turns(5, 50), 1200.0, CFG) == "limited"


def test_short_session_is_insufficient_even_with_rich_content():
    assert check_eligibility(_turns(8, 100), 300.0, CFG) == "insufficient"


def test_too_few_candidate_turns_is_insufficient():
    assert check_eligibility(_turns(4, 100), 1200.0, CFG) == "insufficient"


def test_too_few_candidate_words_is_insufficient():
    # 6 turns x 30 words = 180 < 200.
    assert check_eligibility(_turns(6, 30), 1200.0, CFG) == "insufficient"


def test_empty_transcript_is_insufficient():
    assert check_eligibility([], 1200.0, CFG) == "insufficient"


def test_consecutive_candidate_segments_count_as_one_turn():
    # A turn is a maximal run of candidate speech, not a raw segment count:
    # the transcriber may split one long answer into several segments.
    segments = [
        TranscriptSegment(start_s=0.0, end_s=5.0, speaker="interviewer",
                          text="Question?"),
    ]
    for i in range(6):
        segments.append(TranscriptSegment(
            start_s=6.0 + i * 10, end_s=15.0 + i * 10, speaker="candidate",
            text=" ".join(["word"] * 60)))
    # 360 words in ONE turn: the word floor passes, the turn floor does not.
    assert check_eligibility(segments, 1200.0, CFG) == "insufficient"


def test_interviewer_speech_never_counts_toward_candidate_words():
    segments = [
        TranscriptSegment(start_s=0.0, end_s=60.0, speaker="interviewer",
                          text=" ".join(["question"] * 1000)),
        TranscriptSegment(start_s=61.0, end_s=70.0, speaker="candidate",
                          text="Short answer."),
    ]
    assert check_eligibility(segments, 1200.0, CFG) == "insufficient"
