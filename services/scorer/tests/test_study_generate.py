import pytest

from factories import make_rubric
from scorer.study.generate import generate_study


class Package:
    rubric = make_rubric()


def test_zero_scored_sessions_is_refused():
    with pytest.raises(ValueError, match="at least one"):
        generate_study(Package(), [], object())
