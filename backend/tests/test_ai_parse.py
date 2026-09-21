"""AI parse regression tests: account routing and multimodal fallback."""
from app.routers import ai


def test_normalize_prefers_account_alias_from_source_text(monkeypatch):
    monkeypatch.setattr(ai, "_account_aliases", lambda: [("Demo Visa", "card-demo")])
    data = {
        "amount": 120,
        "kind": "expense",
        "date": "2026-09-15",
        "merchant": "Demo Visa",
        "category": "c_food",
        "account": None,
        "notes": "",
    }
    out = ai._normalize(data, "2026-09-15", "午餐 120 Demo Visa")
    assert out["amount_minor"] == 12000
    assert out["account"] == "card-demo"
    assert out["merchant"] == "午餐"


def test_image_fallback_sends_multimodal_payload(monkeypatch):
    calls = []

    def fake_post(url, payload, timeout, headers=None):
        calls.append((url, payload, timeout, headers))
        if "127.0.0.1" in url:
            raise OSError("local vision unavailable")
        return {
            "choices": [{"message": {"content": (
                '{"amount":128,"kind":"expense","date":"2026-09-15",'
                '"merchant":"7-ELEVEN","category":"c_food",'
                '"account":"card-demo","notes":"Lunch"}'
            )}}]
        }
    monkeypatch.setattr(ai, "_post_json", fake_post)
    monkeypatch.setattr(ai, "_account_aliases", lambda: [("Demo Visa", "card-demo")])
    monkeypatch.setattr(ai, "OLLAMA_MODEL", "demo-vision")
    monkeypatch.setattr(ai, "_load_or_key", lambda: "test-key")
    monkeypatch.setattr(ai, "OPENROUTER_VISION_MODEL", "google/gemini-3.5-flash-lite")

    result = ai.parse(ai.AiParseInput(image_b64="data:image/jpeg;base64,abc"))

    assert result["ok"] is True
    assert result["engine"] == "openrouter-vision"
    assert result["amount_minor"] == 12800
    assert len(calls) == 2

    _, payload, _, headers = calls[1]
    assert payload["model"] == "google/gemini-3.5-flash-lite"
    content = payload["messages"][0]["content"]
    assert isinstance(content, list)
    assert content[0]["type"] == "text"
    assert content[1]["type"] == "image_url"
    assert content[1]["image_url"]["url"].startswith("data:image/jpeg;base64,")
    assert headers == {"Authorization": "Bearer test-key"}
