"""Optional AI must never borrow credentials from another project."""
import builtins
from app.routers import ai, ai_ask

def test_ai_keys_are_environment_only(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    def forbidden_open(*args, **kwargs):
        raise AssertionError("Credential lookup must not open any file")
    monkeypatch.setattr(builtins, "open", forbidden_open)
    assert ai._load_or_key() is None
    assert ai_ask._load_or_key() is None
    monkeypatch.setenv("OPENROUTER_API_KEY", "synthetic-test-only")
    assert ai._load_or_key() == "synthetic-test-only"
    assert ai_ask._load_or_key() == "synthetic-test-only"

def test_unconfigured_chat_does_not_make_requests(monkeypatch):
    monkeypatch.setattr(ai_ask, "OLLAMA_MODEL", "")
    monkeypatch.setattr(ai_ask, "OPENROUTER_MODEL", "")
    monkeypatch.setattr(ai_ask, "_month_stats", lambda month: {})
    monkeypatch.setattr(ai_ask, "_fmt_stats", lambda stats: "empty")
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    calls = []
    def forbidden_network(*args, **kwargs):
        calls.append(args)
        raise AssertionError("Unconfigured AI must not make network requests")
    monkeypatch.setattr(ai_ask, "_post_json", forbidden_network)
    result = ai_ask.ask(ai_ask.AiAskInput(question="本月支出？"))
    assert result["ok"] is False
    assert calls == []
