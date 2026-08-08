from fakes import FakeDatabase
from scorer.study.job import generate_study_job


def test_job_swallows_failure_and_marks_row_failed():
    db = FakeDatabase()
    generate_study_job("missing", db, object())
    assert db.get_study("missing").status == "failed"
