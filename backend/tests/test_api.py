from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_health():
    assert client.get("/health").json()["status"] == "ok"

def test_seed_and_flow():
    chs = client.get("/challenges").json()
    assert len(chs) >= 1
    cid = chs[0]["id"]
    att = client.post("/attempts", json={"challenge_id": cid, "candidate_name": "Test Candidate", "candidate_email": "t@example.com"})
    assert att.status_code == 201
    aid = att.json()["id"]
    for payload in [
        {"type": "prompt", "payload": {"text": "Investigate pagination in app/main.py for offset bug"}},
        {"type": "file_view", "payload": {"path": "app/main.py"}},
        {"type": "file_edit", "payload": {"path": "app/main.py"}},
        {"type": "test_run", "payload": {"command": "pytest -q"}},
    ]:
        r = client.post(f"/attempts/{aid}/events", json=payload)
        assert r.status_code == 201
    rep = client.post(f"/attempts/{aid}/submit", json={"scorer_output": "FS_SCORE: 80%"})
    assert rep.status_code == 200
    data = rep.json()
    assert data["functional_score"] == 80.0 and data["total_score"] > 0 and data["timeline"]
    got = client.get(f"/attempts/{aid}/report")
    assert got.status_code == 200

def test_create_challenge_defaults():
    r = client.post("/challenges", json={"title": "New", "difficulty": "easy"})
    assert r.status_code == 201
    assert r.json()["score"] == 50 and r.json()["recommended_time_minutes"] == 15

def test_404():
    assert client.get("/challenges/nope").status_code == 404
