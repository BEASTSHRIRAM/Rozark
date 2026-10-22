from fastapi.testclient import TestClient
from app.main import app
client = TestClient(app)

def test_report_evidence_fields():
    cid = client.get("/challenges").json()[0]["id"]
    aid = client.post("/attempts", json={"challenge_id": cid, "candidate_name": "RE"}).json()["id"]
    events = [
        {"type": "prompt", "payload": {"text": "Investigate the pagination bug in app/main.py and check the offset error", "phase": "planning"}},
        {"type": "prompt", "payload": {"text": "Now fix the offset calculation in app/main.py and run the test suite", "phase": "building"}},
        {"type": "file_view", "payload": {"path": "app/main.py"}},
        {"type": "file_view", "payload": {"path": "app/models.py"}},
        {"type": "file_view", "payload": {"path": "tests/test_public.py"}},
        {"type": "file_edit", "payload": {"path": "app/main.py"}},
        {"type": "test_run", "payload": {"command": "pytest -q"}},
        {"type": "file_edit", "payload": {"path": "app/main.py"}},
        {"type": "test_run", "payload": {"command": "pytest -q"}},
        {"type": "test_run", "payload": {"command": "pytest -q"}},
        {"type": "token_usage", "actor": "system", "payload": {"tokens_in": 100, "tokens_out": 50, "phase": "building"}},
        {"type": "git_snapshot", "actor": "system", "payload": {"snapshot_id": "snap_x"}},
    ]
    for ev in events:
        r = client.post(f"/attempts/{aid}/events", json=ev)
        assert r.status_code == 201, r.text
    rep = client.post(f"/attempts/{aid}/submit", json={"scorer_output": "FS_SCORE: 90%"})
    assert rep.status_code == 200, rep.text
    d = rep.json()
    assert d["verdict"] in ("Strong hire signal", "Hire signal", "Mixed signals", "Weak signal")
    assert isinstance(d["signals"], list) and isinstance(d["concerns"], list)
    assert any("Ran tests 3 times" in s["text"] for s in d["signals"])
    assert all("evidence_event_ids" in s for s in d["signals"] + d["concerns"])
    m = d["metrics"]
    assert m["prompts_total"] == 2 and m["prompts_by_phase"] == {"planning": 1, "building": 1}
    assert m["tokens_used"] == 150 and m["token_budget"] > 0
    assert m["test_runs"] == 3 and m["files_edited"] == 2 and m["git_snapshots"] == 1
    assert m["duration_seconds"] >= 0 and m["time_to_first_edit_seconds"] is not None
    got = client.get(f"/attempts/{aid}/report").json()
    assert got["verdict"] == d["verdict"] and got["metrics"]["test_runs"] == 3

def test_report_no_tests_concern():
    cid = client.get("/challenges").json()[0]["id"]
    aid = client.post("/attempts", json={"challenge_id": cid, "candidate_name": "NT"}).json()["id"]
    client.post(f"/attempts/{aid}/events", json={"type": "prompt", "payload": {"text": "short"}})
    rep = client.post(f"/attempts/{aid}/submit", json={"scorer_output": "FS_SCORE: 10%"})
    d = rep.json()
    assert d["verdict"] == "Weak signal"
    assert any(c["text"] == "Never ran tests" for c in d["concerns"])
    assert d["metrics"]["test_runs"] == 0 and d["metrics"]["time_to_first_edit_seconds"] is None
