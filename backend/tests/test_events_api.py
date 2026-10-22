from fastapi.testclient import TestClient
from app.main import app
client = TestClient(app)

def _attempt():
    chs = client.get("/challenges").json()
    r = client.post("/attempts", json={"challenge_id": chs[0]["id"], "candidate_name": "Ev"})
    assert r.status_code == 201
    return r.json()["id"]

def test_batch_append():
    aid = _attempt()
    r = client.post(f"/attempts/{aid}/events/batch", json={"events": [
        {"type": "prompt", "payload": {"text": "plan the fix for the pagination bug in main.py"}},
        {"type": "file_view", "payload": {"path": "app/main.py"}},
        {"type": "terminal_cmd", "actor": "candidate", "payload": {"command": "ls"}},
    ]})
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["accepted"] == 3 and len(d["events"]) == 3
    seqs = [e["seq"] for e in d["events"]]
    assert seqs == sorted(seqs)
    assert client.post("/attempts/nope/events/batch", json={"events": []}).status_code == 404

def test_list_filters():
    aid = _attempt()
    client.post(f"/attempts/{aid}/events/batch", json={"events": [
        {"type": "prompt", "payload": {"text": "first prompt with enough detail about the bug"}},
        {"type": "file_edit", "payload": {"path": "a.py"}},
        {"type": "file_edit", "payload": {"path": "b.py"}},
        {"type": "token_usage", "actor": "system", "payload": {"tokens_in": 10, "tokens_out": 5}},
    ]})
    all_ev = client.get(f"/attempts/{aid}/events").json()
    assert len(all_ev) == 4
    edits = client.get(f"/attempts/{aid}/events", params={"types": "file_edit"}).json()
    assert len(edits) == 2
    multi = client.get(f"/attempts/{aid}/events", params={"types": "file_edit,prompt"}).json()
    assert len(multi) == 3
    by_actor = client.get(f"/attempts/{aid}/events", params={"actor": "system"}).json()
    assert len(by_actor) == 1 and by_actor[0]["type"] == "token_usage"
    since = client.get(f"/attempts/{aid}/events", params={"since_seq": all_ev[1]["seq"]}).json()
    assert len(since) == 2 and since[0]["seq"] > all_ev[1]["seq"]
    page = client.get(f"/attempts/{aid}/events", params={"limit": 2, "offset": 1}).json()
    assert [e["seq"] for e in page] == [all_ev[1]["seq"], all_ev[2]["seq"]]

def test_summary():
    aid = _attempt()
    client.post(f"/attempts/{aid}/events/batch", json={"events": [
        {"type": "prompt", "payload": {"text": "a detailed prompt about fixing the api bug"}},
        {"type": "terminal_cmd", "payload": {"command": "ls"}},
        {"type": "terminal_output", "actor": "system", "payload": {"text": "x"}},
        {"type": "file_edit", "payload": {"path": "a.py"}},
        {"type": "git_snapshot", "actor": "system", "payload": {}},
        {"type": "session_started", "actor": "system", "payload": {}},
    ]})
    s = client.get(f"/attempts/{aid}/events/summary")
    assert s.status_code == 200, s.text
    d = s.json()
    assert d["total"] == 6
    assert d["by_type"]["prompt"] == 1 and d["by_type"]["file_edit"] == 1
    assert d["by_stream"] == {"terminal": 2, "files": 2, "agent": 1, "system": 1}
    assert d["by_actor"]["candidate"] == 3 and d["by_actor"]["system"] == 3
    assert client.get("/attempts/nope/events/summary").status_code == 404

def test_batch_hard_stop_403_partial_stays():
    chs = client.get("/challenges").json()
    ch = client.post("/challenges", json={"title": "TinyBudget", "agent_config": {"token_budget": 10}}).json()
    aid = client.post("/attempts", json={"challenge_id": ch["id"], "candidate_name": "HB"}).json()["id"]
    client.post(f"/attempts/{aid}/events", json={"type": "token_usage", "actor": "system", "payload": {"tokens_in": 20, "tokens_out": 0}})
    r = client.post(f"/attempts/{aid}/events/batch", json={"events": [
        {"type": "file_view", "payload": {"path": "x.py"}},
        {"type": "prompt", "payload": {"text": "should be refused by the hard stop"}},
    ]})
    assert r.status_code == 403, r.text
    types = [e["type"] for e in client.get(f"/attempts/{aid}/events").json()]
    assert "file_view" in types and types.count("prompt") == 0
