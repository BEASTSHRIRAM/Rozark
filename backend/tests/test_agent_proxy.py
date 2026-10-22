"""Agent budget proxy: provider selection (Groq default, Anthropic
fallback), request shape, usage metering, and the graceful 503 when no
provider key is configured. All provider HTTP is mocked — no real keys.
"""
import httpx
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

ALL_KEYS = ("GROQ_API_KEY", "GROQ_MODEL", "ANTHROPIC_API_KEY", "ROZARK_AI_API_KEY", "ROZARK_AI_MODEL")


def _no_keys(monkeypatch):
    for name in ALL_KEYS:
        monkeypatch.delenv(name, raising=False)


def _attempt(budget=None):
    if budget is not None:
        ch = client.post("/challenges", json={"title": "ProxyBudget", "agent_config": {"token_budget": budget}}).json()
        cid = ch["id"]
    else:
        cid = client.get("/challenges").json()[0]["id"]
    r = client.post("/attempts", json={"challenge_id": cid, "candidate_name": "PX"})
    assert r.status_code == 201
    return r.json()["id"]


# --- Anthropic fakes (fallback provider) ------------------------------------

class _FakeAnthropicResp:
    status_code = 200

    def json(self):
        return {"content": [{"type": "text", "text": "Fake agent reply"}],
                "usage": {"input_tokens": 11, "output_tokens": 7}}


class _FakeAnthropicClient:
    def __init__(self, *a, **k): pass

    def post(self, url, headers=None, json=None):
        assert "api.anthropic.com" in url
        assert headers["x-api-key"] == "test-key"
        return _FakeAnthropicResp()


# --- Groq fakes (default provider) ------------------------------------------

class _FakeGroqResp:
    status_code = 200

    def json(self):
        return {"choices": [{"message": {"role": "assistant", "content": "Groq agent reply"}}],
                "usage": {"prompt_tokens": 13, "completion_tokens": 9, "total_tokens": 22}}


class _FakeGroqClient:
    last = {}

    def __init__(self, *a, **k): pass

    def post(self, url, headers=None, json=None):
        _FakeGroqClient.last = {"url": url, "headers": headers, "json": json}
        assert url == "https://api.groq.com/openai/v1/chat/completions"
        assert headers["Authorization"] == "Bearer groq-test-key"
        return _FakeGroqResp()


# --- Not configured ----------------------------------------------------------

def test_status_and_chat_not_configured(monkeypatch):
    _no_keys(monkeypatch)
    s = client.get("/agent/status")
    assert s.status_code == 200
    assert s.json()["configured"] is False and s.json()["provider"] == "groq" and s.json()["model"]
    aid = _attempt()
    r = client.post(f"/attempts/{aid}/agent/chat", json={"prompt": "help me"})
    assert r.status_code == 503, r.text
    assert r.json()["code"] == "agent_not_configured"
    assert "GROQ_API_KEY" in r.json()["detail"]
    assert client.post("/attempts/nope/agent/chat", json={"prompt": "x"}).status_code == 404


# --- Groq --------------------------------------------------------------------

def test_groq_status_model_default_and_override(monkeypatch):
    _no_keys(monkeypatch)
    monkeypatch.setenv("GROQ_API_KEY", "groq-test-key")
    s = client.get("/agent/status").json()
    assert s["configured"] is True and s["provider"] == "groq"
    assert s["model"] == "openai/gpt-oss-120b"
    monkeypatch.setenv("GROQ_MODEL", "llama-3.1-8b-instant")
    assert client.get("/agent/status").json()["model"] == "llama-3.1-8b-instant"


def test_groq_chat_mocked_records_events_and_budget(monkeypatch):
    _no_keys(monkeypatch)
    monkeypatch.setenv("GROQ_API_KEY", "groq-test-key")
    monkeypatch.setattr(httpx, "Client", _FakeGroqClient)
    aid = _attempt()
    r = client.post(f"/attempts/{aid}/agent/chat", json={"prompt": "fix the pagination bug", "phase": "debugging"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["response_text"] == "Groq agent reply" and d["tokens_in"] == 13 and d["tokens_out"] == 9
    assert d["budget"]["used"] == 22
    # Request shape: OpenAI-compatible chat completions, default model,
    # system + user messages.
    sent = _FakeGroqClient.last["json"]
    assert sent["model"] == "openai/gpt-oss-120b"
    assert [m["role"] for m in sent["messages"]] == ["system", "user"]
    assert sent["messages"][1]["content"] == "fix the pagination bug"
    events = client.get(f"/attempts/{aid}/events").json()
    assert [e["type"] for e in events] == ["prompt", "token_usage", "agent_response"]
    usage_event = events[1]
    assert usage_event["payload"]["provider"] == "groq" and usage_event["payload"]["model"] == "openai/gpt-oss-120b"


def test_groq_takes_precedence_over_anthropic(monkeypatch):
    _no_keys(monkeypatch)
    monkeypatch.setenv("GROQ_API_KEY", "groq-test-key")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    # The fake asserts the Groq URL + Bearer header; an Anthropic call
    # through it would fail the assertion.
    monkeypatch.setattr(httpx, "Client", _FakeGroqClient)
    assert client.get("/agent/status").json()["provider"] == "groq"
    aid = _attempt()
    r = client.post(f"/attempts/{aid}/agent/chat", json={"prompt": "help"})
    assert r.status_code == 200, r.text
    assert r.json()["response_text"] == "Groq agent reply"


def test_groq_chat_hard_stop_403(monkeypatch):
    _no_keys(monkeypatch)
    monkeypatch.setenv("GROQ_API_KEY", "groq-test-key")
    monkeypatch.setattr(httpx, "Client", _FakeGroqClient)
    aid = _attempt(budget=5)
    client.post(f"/attempts/{aid}/events", json={"type": "token_usage", "actor": "system", "payload": {"tokens_in": 9, "tokens_out": 0}})
    r = client.post(f"/attempts/{aid}/agent/chat", json={"prompt": "more help"})
    assert r.status_code == 403, r.text


def test_groq_chat_submitted_409(monkeypatch):
    _no_keys(monkeypatch)
    monkeypatch.setenv("GROQ_API_KEY", "groq-test-key")
    monkeypatch.setattr(httpx, "Client", _FakeGroqClient)
    aid = _attempt()
    client.post(f"/attempts/{aid}/submit", json={"scorer_output": "FS_SCORE: 40%"})
    assert client.post(f"/attempts/{aid}/agent/chat", json={"prompt": "x"}).status_code == 409


# --- Anthropic fallback --------------------------------------------------------

def test_anthropic_fallback_chat_mocked(monkeypatch):
    _no_keys(monkeypatch)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(httpx, "Client", _FakeAnthropicClient)
    s = client.get("/agent/status").json()
    assert s["configured"] is True and s["provider"] == "anthropic" and s["model"] == "claude-sonnet-4-5"
    aid = _attempt()
    r = client.post(f"/attempts/{aid}/agent/chat", json={"prompt": "fix the pagination bug", "phase": "debugging"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["response_text"] == "Fake agent reply" and d["tokens_in"] == 11 and d["tokens_out"] == 7
    assert d["budget"]["used"] == 18
    types = [e["type"] for e in client.get(f"/attempts/{aid}/events").json()]
    assert types == ["prompt", "token_usage", "agent_response"]


def test_rozark_ai_key_counts_as_anthropic(monkeypatch):
    _no_keys(monkeypatch)
    monkeypatch.setenv("ROZARK_AI_API_KEY", "test-key")
    monkeypatch.setattr(httpx, "Client", _FakeAnthropicClient)
    s = client.get("/agent/status").json()
    assert s["configured"] is True and s["provider"] == "anthropic"
