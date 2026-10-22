from fastapi.testclient import TestClient
from app.main import app
from app.store import store
client = TestClient(app)

def _attempt():
    chs = client.get("/challenges").json()
    r = client.post("/attempts", json={"challenge_id": chs[0]["id"], "candidate_name": "LC"})
    assert r.status_code == 201, r.text
    return r.json()

def test_session_fields_on_create():
    a = _attempt()
    assert a["started_at"] and a["time_limit_minutes"] > 0 and a["expires_at"]
    s = client.get(f"/attempts/{a['id']}/session")
    assert s.status_code == 200, s.text
    d = s.json()
    assert d["attempt_id"] == a["id"] and d["status"] == "in_progress"
    assert d["elapsed_seconds"] >= 0 and d["remaining_seconds"] > 0
    assert d["budget"]["budget"] == a["token_budget"] and d["sandbox_status"] == "not_started"

def test_heartbeat_updates():
    a = _attempt()
    r = client.post(f"/attempts/{a['id']}/heartbeat")
    assert r.status_code == 200, r.text
    att = client.get(f"/attempts/{a['id']}").json()
    assert att["last_heartbeat_at"]
    assert client.post("/attempts/nope/heartbeat").status_code == 404
    assert client.get("/attempts/nope/session").status_code == 404

def test_expiry_via_past_expires_at():
    a = _attempt()
    att = store.attempts[a["id"]]
    att.expires_at = "2000-01-01T00:00:00Z"
    store.save_attempt(att)
    s = client.get(f"/attempts/{a['id']}/session").json()
    assert s["status"] == "expired" and s["remaining_seconds"] == 0
    att2 = client.get(f"/attempts/{a['id']}").json()
    assert att2["status"] == "expired"
    types = [e["type"] for e in client.get(f"/attempts/{a['id']}/events").json()]
    assert "session_expired" in types

def test_heartbeat_on_submitted_is_noop():
    a = _attempt()
    r = client.post(f"/attempts/{a['id']}/submit", json={"scorer_output": "FS_SCORE: 50%"})
    assert r.status_code == 200, r.text
    s = client.post(f"/attempts/{a['id']}/heartbeat").json()
    assert s["status"] == "submitted"
    att = client.get(f"/attempts/{a['id']}").json()
    assert att["last_heartbeat_at"] == ""
