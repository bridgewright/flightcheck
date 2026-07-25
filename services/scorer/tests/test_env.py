import pytest

from scorer.env import load_env, require_key


def test_require_key_returns_value_when_set(monkeypatch):
    monkeypatch.setenv("PROBE_TEST_KEY", "sk-value")
    assert require_key("PROBE_TEST_KEY") == "sk-value"


def test_require_key_exits_with_actionable_message(monkeypatch):
    monkeypatch.delenv("PROBE_TEST_KEY", raising=False)
    with pytest.raises(SystemExit) as exc:
        require_key("PROBE_TEST_KEY")
    assert "PROBE_TEST_KEY not set" in str(exc.value)
    assert ".env" in str(exc.value)


def test_load_env_reads_the_dotenv_file(monkeypatch, tmp_path):
    monkeypatch.delenv("PROBE_TEST_KEY", raising=False)
    env_file = tmp_path / ".env"
    env_file.write_text("PROBE_TEST_KEY=from-dotenv\n")
    load_env(env_file)
    assert require_key("PROBE_TEST_KEY") == "from-dotenv"
    monkeypatch.delenv("PROBE_TEST_KEY", raising=False)   # load_dotenv writes os.environ
