import httpx
from fastapi.testclient import TestClient
from app.main import app
client = TestClient(app)

def _attempt(budget=None):
    if budget is not None:
        ch = client.post("/challenges", json={"title": "ProxyBudget", "agent_config": {"token_budget": budget}}).json()
        cid = ch["id"]
    else:
        cid = client.get("/challenges").json()[0]["id"]
    r = client.post("/attempts", json={"challenge_id": cid, "candidate_name": "PX"})
    assert r.status_code == 201
    return r.json()["id"]

class _FakeResp:
    status_code = 200
    def json(self):
        return {"content": [{"type": "text", "text": "Fake agent reply"}],
                "usage": {"input_tokens": 11, "output_tokens": 7}}

class _FakeClient:
    def __init__(self, *a, **k): pass
    def post(self, url, headers=None, json=None):
        assert "api.anthropic.com" in url
        assert headers["x-api-key"] == "test-key"
        return _FakeResp()

def test_status_and_chat_not_configured(monkeypatch):
    monkeypatch.delenv("ROZARK_AI_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    s = client.get("/agent/status")
    assert s.status_code == 200
    assert s.json()["configured"] is False and s.json()["provider"] == "anthropic" and s.json()["model"]
    aid = _attempt()
    r = client.post(f"/attempts/{aid}/agent/chat", json={"prompt": "help me"})
    assert r.status_code == 503, r.text
    assert r.json()["code"] == "agent_not_configured"
    assert client.post("/attempts/nope/agent/chat", json={"prompt": "x"}).status_code == 404

def test_chat_mocked_records_events_and_budget(monkeypatch):
    monkeypatch.setenv("ROZARK_AI_API_KEY", "test-key")
    monkeypatch.setattr(httpx, "Client", _FakeClient)
    assert client.get("/agent/status").json()["configured"] is True
    aid = _attempt()
    r = client.post(f"/attempts/{aid}/agent/chat", json={"prompt": "fix the pagination bug", "phase": "debugging"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["response_text"] == "Fake agent reply" and d["tokens_in"] == 11 and d["tokens_out"] == 7
    assert d["budget"]["used"] == 18
    types = [e["type"] for e in client.get(f"/attempts/{aid}/events").json()]
    assert types == ["prompt", "token_usage", "agent_response"]

def test_chat_hard_stop_403(monkeypatch):
    monkeypatch.setenv("ROZARK_AI_API_KEY", "test-key")
    monkeypatch.setattr(httpx, "Client", _FakeClient)
    aid = _attempt(budget=5)
    client.post(f"/attempts/{aid}/events", json={"type": "token_usage", "actor": "system", "payload": {"tokens_in": 9, "tokens_out": 0}})
    r = client.post(f"/attempts/{aid}/agent/chat", json={"prompt": "more help"})
    assert r.status_code == 403, r.text

def test_chat_submitted_409(monkeypatch):
    monkeypatch.setenv("ROZARK_AI_API_KEY", "test-key")
    monkeypatch.setattr(httpx, "Client", _FakeClient)
    aid = _attempt()
    client.post(f"/attempts/{aid}/submit", json={"scorer_output": "FS_SCORE: 40%"})
    assert client.post(f"/attempts/{aid}/agent/chat", json={"prompt": "x"}).status_code == 409
