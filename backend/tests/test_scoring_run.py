import sys
from fastapi.testclient import TestClient
from app.main import app
client = TestClient(app)

def _setup():
    cmd = f'{sys.executable} -c "print(\'FS_SCORE: 80%\')"'
    ch = client.post("/challenges", json={"title": "ScoreRunChal", "scoring": {"mode": "custom", "scoring_command": cmd}}).json()
    aid = client.post("/attempts", json={"challenge_id": ch["id"], "candidate_name": "SR"}).json()["id"]
    return aid

def test_run_requires_workspace():
    aid = _setup()
    assert client.post(f"/attempts/{aid}/score/run").status_code == 409
    g = client.get(f"/attempts/{aid}/score").json()
    assert g["latest"] is None and g["runs"] == []

def test_run_fs_score_and_submit_fallback():
    aid = _setup()
    assert client.post(f"/attempts/{aid}/sandbox/start").status_code == 200
    r = client.post(f"/attempts/{aid}/score/run")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["score"] == 80.0 and d["source"] == "fs_score" and d["exit_code"] == 0
    assert "FS_SCORE" in d["stdout_tail"]
    g = client.get(f"/attempts/{aid}/score").json()
    assert g["latest"]["score"] == 80.0 and len(g["runs"]) == 1
    types = [e["type"] for e in client.get(f"/attempts/{aid}/events").json()]
    assert "test_run" in types
    rep = client.post(f"/attempts/{aid}/submit", json={})
    assert rep.status_code == 200, rep.text
    assert rep.json()["functional_score"] == 80.0

def test_submit_explicit_beats_run():
    aid = _setup()
    client.post(f"/attempts/{aid}/sandbox/start")
    client.post(f"/attempts/{aid}/score/run")
    rep = client.post(f"/attempts/{aid}/submit", json={"scorer_output": "FS_SCORE: 30%"})
    assert rep.json()["functional_score"] == 30.0
