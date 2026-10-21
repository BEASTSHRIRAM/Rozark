"""Tests for the event-log schema v1, recorder, token budget, and replay.

Covers docs/EVENT_LOG_SCHEMA.md + docs/SANDBOX.md backend behaviour:
ordering/seq, phase-tagged prompts, token budget cap + hard stop, replay.
"""
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def _challenge_id():
    return client.get("/challenges").json()[0]["id"]


def _start_attempt(challenge_id=None):
    r = client.post("/attempts", json={
        "challenge_id": challenge_id or _challenge_id(),
        "candidate_name": "Sandbox Tester",
        "candidate_email": "sandbox@example.com",
    })
    assert r.status_code == 201
    return r.json()


def _post_event(aid, payload):
    return client.post(f"/attempts/{aid}/events", json=payload)


def test_event_ordering_and_seq():
    att = _start_attempt()
    aid = att["id"]
    assert att["session_id"] == aid
    posts = [
        {"type": "session_started", "actor": "system", "payload": {"challenge_id": att["challenge_id"]}},
        {"type": "brief_viewed", "payload": {"section": "acceptance_criteria"}},
        {"type": "prompt", "payload": {"text": "Plan first", "phase": "planning"}},
        {"type": "terminal_cmd", "payload": {"command": "ls"}},
        {"type": "git_snapshot", "actor": "system", "payload": {"snapshot_id": "snap_0001", "commit_ref": "abc123", "files_changed": []}},
    ]
    created = []
    for p in posts:
        r = _post_event(aid, p)
        assert r.status_code == 201, r.text
        created.append(r.json())
    seqs = [e["seq"] for e in created]
    assert seqs == [1, 2, 3, 4, 5]
    assert [e["sequence"] for e in created] == seqs  # seq mirrors legacy field
    assert len({e["id"] for e in created}) == 5
    for e in created:
        assert e["attempt_id"] == aid and e["session_id"] == aid and e["ts"]
    log = client.get(f"/attempts/{aid}/events").json()
    assert [e["seq"] for e in log] == seqs


def test_phase_tagged_prompts_preserved():
    att = _start_attempt()
    aid = att["id"]
    r = _post_event(aid, {"type": "prompt", "payload": {
        "text": "Tests fail on page 2 — inspect the offset in app/main.py",
        "phase": "debugging", "file_refs": ["app/main.py"], "agent": "claude_code"}})
    assert r.status_code == 201
    ev = r.json()
    assert ev["payload"]["phase"] == "debugging"
    assert ev["payload"]["file_refs"] == ["app/main.py"]
    # phase-tagged token usage lands in the per-phase budget split
    r2 = _post_event(aid, {"type": "token_usage", "actor": "system", "payload": {
        "phase": "debugging", "tokens_in": 100, "tokens_out": 50}})
    assert r2.status_code == 201
    budget = client.get(f"/attempts/{aid}/budget").json()
    assert budget["by_phase"]["debugging"] == 150


def test_token_budget_cap_flag_and_hard_stop():
    ch = client.post("/challenges", json={
        "title": "Budget-capped challenge", "difficulty": "easy",
        "agent_config": {"token_budget": 1000}}).json()
    att = _start_attempt(ch["id"])
    aid = att["id"]
    assert att["token_budget"] == 1000 and att["budget_exceeded"] is False
    r = _post_event(aid, {"type": "token_usage", "actor": "system", "payload": {
        "phase": "planning", "tokens_total": 600}})
    assert r.status_code == 201
    assert r.json()["payload"]["cumulative_tokens"] == 600
    r = _post_event(aid, {"type": "token_usage", "actor": "system", "payload": {
        "phase": "building", "tokens_total": 500}})
    assert r.status_code == 201
    assert r.json()["payload"]["cumulative_tokens"] == 1100
    budget = client.get(f"/attempts/{aid}/budget").json()
    assert budget["used"] == 1100 and budget["budget"] == 1000
    assert budget["by_phase"] == {"planning": 600, "building": 500}
    assert budget["budget_exceeded"] is True and budget["hard_stop"] is True
    log = client.get(f"/attempts/{aid}/events").json()
    assert any(e["type"] == "budget_exceeded" for e in log)
    # hard stop: further agent activity is refused
    r = _post_event(aid, {"type": "prompt", "payload": {"text": "more", "phase": "building"}})
    assert r.status_code == 403


def test_replay_endpoint_ordered_with_snapshots():
    att = _start_attempt()
    aid = att["id"]
    _post_event(aid, {"type": "session_started", "actor": "system", "payload": {}})
    _post_event(aid, {"type": "file_edit", "payload": {"path": "app/main.py", "diff_ref": "snap_0001:app/main.py", "snapshot_id": "snap_0001"}})
    _post_event(aid, {"type": "git_snapshot", "actor": "system", "payload": {"snapshot_id": "snap_0001", "commit_ref": "deadbeef", "files_changed": ["app/main.py"], "reason": "interval"}})
    r = client.get(f"/attempts/{aid}/replay")
    assert r.status_code == 200
    data = r.json()
    assert data["attempt_id"] == aid and data["session_id"] == aid
    assert [e["seq"] for e in data["events"]] == [1, 2, 3]
    assert len(data["git_snapshots"]) == 1
    snap = data["git_snapshots"][0]
    assert snap["snapshot_id"] == "snap_0001" and snap["commit_ref"] == "deadbeef"
    assert snap["event_id"] and snap["seq"] == 3
    assert data["token_budget"]["budget"] == att["token_budget"]


def test_legacy_terminal_type_still_accepted():
    att = _start_attempt()
    r = _post_event(att["id"], {"type": "terminal", "payload": {"command": "pytest -q"}})
    assert r.status_code == 201 and r.json()["type"] == "terminal"


def test_negative_token_usage_cannot_reduce_recorded_usage():
    # Regression: a negative token figure used to drive tokens_used below
    # zero (used=-5000, remaining>budget) — a budget-cap bypass.
    att = _start_attempt()
    aid = att["id"]
    _post_event(aid, {"type": "token_usage", "actor": "system",
                      "payload": {"phase": "building", "tokens_total": 900}})
    r = _post_event(aid, {"type": "token_usage", "actor": "system",
                          "payload": {"phase": "building", "tokens_total": -950}})
    assert r.status_code == 201
    budget = client.get(f"/attempts/{aid}/budget").json()
    assert budget["used"] == 900 and budget["by_phase"] == {"building": 900}


def test_malformed_token_values_do_not_500():
    att = _start_attempt()
    r = _post_event(att["id"], {"type": "token_usage", "actor": "system",
                                "payload": {"tokens_in": "lots", "tokens_out": None}})
    assert r.status_code == 201
    budget = client.get(f"/attempts/{att['id']}/budget").json()
    assert budget["used"] == 0


def test_rubric_weights_must_sum_to_one():
    r = client.post("/challenges", json={
        "title": "Bad weights", "rubric_weights": {"functional": 1.0, "ai_collaboration": 1.0}})
    assert r.status_code == 422


def test_negative_token_budget_rejected():
    r = client.post("/challenges", json={
        "title": "Neg budget", "agent_config": {"token_budget": -5}})
    assert r.status_code == 422


def test_events_after_submit_are_frozen_and_resubmit_rejected():
    att = _start_attempt()
    aid = att["id"]
    r = client.post(f"/attempts/{aid}/submit", json={"scorer_output": "FS_SCORE: 50%"})
    assert r.status_code == 200
    r = _post_event(aid, {"type": "prompt", "payload": {"text": "after submit"}})
    assert r.status_code == 409
    r = client.post(f"/attempts/{aid}/submit", json={"scorer_output": "FS_SCORE: 99%"})
    assert r.status_code == 409
    # the original report is untouched by the rejected re-submit
    rep = client.get(f"/attempts/{aid}/report").json()
    assert rep["functional_score"] == 50.0
