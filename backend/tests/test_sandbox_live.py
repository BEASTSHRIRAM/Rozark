"""Increment 3 — persistence + live sandbox.

Covers: SQLite store durability (store-level restart equivalent),
backend interface selection (docker unavailable -> local + note),
sandbox start (workspace materialised + session_started/snapshot events),
the websocket PTY (real echo, and the stream is RECORDED into the event
log), stop, and submit freezing the sandbox (WS rejected).
"""
import os
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app
from app.sandbox import DockerSandbox, LocalProcessSandbox, select_backend
from app.store import Store
from app import models

client = TestClient(app)


def _start_attempt():
    cid = client.get("/challenges").json()[0]["id"]
    r = client.post("/attempts", json={
        "challenge_id": cid, "candidate_name": "Live Sandbox",
        "candidate_email": "live@example.com"})
    assert r.status_code == 201
    return r.json()


def _events(aid):
    return client.get(f"/attempts/{aid}/events").json()


# ---------------------------------------------------------------------------
# Persistence (store-level restart equivalent: a second Store over the
# same file must see the first Store's data; the server-level restart is
# proven in the live run recorded in the increment report).
# ---------------------------------------------------------------------------
def test_store_survives_reopen(tmp_path):
    db = str(tmp_path / "restart.db")
    s1 = Store(db_path=db)
    ch = models.Challenge(id=s1.next_challenge_id(), title="Persisted challenge")
    s1.challenges[ch.id] = ch
    user = models.UserRecord(id=s1.next_user_id(), company_name="Co", name="N",
                             email="persist@example.com", password_hash="x")
    s1.users[user.email] = user
    att = models.Attempt(id=s1.next_attempt_id(), challenge_id=ch.id,
                         candidate_name="Cand")
    s1.attempts[att.id] = att

    s2 = Store(db_path=db)  # "restart"
    assert s2.challenges[ch.id].title == "Persisted challenge"
    assert s2.users["persist@example.com"].company_name == "Co"
    assert s2.attempts[att.id].candidate_name == "Cand"
    # counters survived too — no id reuse after restart
    assert s2.next_challenge_id() != ch.id
    assert s2.next_attempt_id() != att.id


def test_attempt_events_survive_reopen(tmp_path):
    db = str(tmp_path / "events.db")
    s1 = Store(db_path=db)
    att = models.Attempt(id=s1.next_attempt_id(), challenge_id="chal_x",
                         candidate_name="Cand")
    s1.attempts[att.id] = att
    # mutate in place + explicit save, exactly what the recorder does
    att.tokens_used = 42
    s1.save_attempt(att)
    s2 = Store(db_path=db)
    assert s2.attempts[att.id].tokens_used == 42


# ---------------------------------------------------------------------------
# Backend selection
# ---------------------------------------------------------------------------
def test_select_backend_defaults_to_local():
    backend, note = select_backend()
    assert isinstance(backend, LocalProcessSandbox)
    assert note == ""


def test_select_backend_docker_unavailable_falls_back_with_note(monkeypatch):
    monkeypatch.setattr(DockerSandbox, "available", staticmethod(lambda: False))
    backend, note = select_backend("docker")
    assert isinstance(backend, LocalProcessSandbox)
    assert "docker" in note.lower()


def test_docker_available_reflects_cli(monkeypatch):
    monkeypatch.setattr("app.sandbox.shutil.which", lambda _cmd: None)
    assert DockerSandbox.available() is False
    monkeypatch.setattr("app.sandbox.shutil.which", lambda _cmd: "/usr/bin/docker")
    assert DockerSandbox.available() is True


# ---------------------------------------------------------------------------
# Sandbox lifecycle over HTTP + websocket
# ---------------------------------------------------------------------------
def test_sandbox_start_creates_workspace_and_events():
    att = _start_attempt()
    aid = att["id"]
    r = client.post(f"/attempts/{aid}/sandbox/start")
    assert r.status_code == 200, r.text
    info = r.json()
    assert info["status"] == "active"
    assert info["backend"] in ("local", "docker")
    assert info["ws_url"] == f"/ws/sandbox/{aid}"
    assert info["expires_at"] and info["time_limit_minutes"] == 30
    ws = Path(info["workspace_path"])
    assert (ws / "README.md").exists()
    assert (ws / "app" / "main.py").exists()
    assert (ws / ".git").exists()
    # hidden test source is never materialised into a candidate workspace
    assert not (ws / "tests" / "test_hidden.py").exists()

    types = [e["type"] for e in _events(aid)]
    assert "session_started" in types
    assert "git_snapshot" in types

    r = client.post(f"/attempts/{aid}/sandbox/stop")
    assert r.status_code == 200
    assert r.json()["status"] in ("stopped", "frozen")
    snap_reasons = [e["payload"].get("reason") for e in _events(aid)
                    if e["type"] == "git_snapshot"]
    assert "session_stop" in snap_reasons


def test_sandbox_start_unknown_attempt_404():
    assert client.post("/attempts/nope/sandbox/start").status_code == 404


def test_ws_echo_is_streamed_and_recorded():
    att = _start_attempt()
    aid = att["id"]
    assert client.post(f"/attempts/{aid}/sandbox/start").status_code == 200
    try:
        with client.websocket_connect(f"/ws/sandbox/{aid}") as ws:
            ws.send_text('{"type":"resize","cols":100,"rows":30}')
            ws.send_text("echo rozark-test\n")
            received = ""
            deadline = time.time() + 10
            while "rozark-test" not in received and time.time() < deadline:
                received += ws.receive_bytes().decode(errors="replace")
            assert "rozark-test" in received
    finally:
        client.post(f"/attempts/{aid}/sandbox/stop")
    # give the taps a beat to flush the final line into the log
    deadline = time.time() + 5
    cmds, outs = [], []
    while time.time() < deadline:
        evs = _events(aid)
        cmds = [e for e in evs if e["type"] == "terminal_cmd"]
        outs = [e for e in evs if e["type"] == "terminal_output"]
        if any("echo rozark-test" in e["payload"].get("command", "") for e in cmds) \
                and any("rozark-test" in e["payload"].get("text", "") for e in outs):
            break
        time.sleep(0.2)
    assert any("echo rozark-test" in e["payload"].get("command", "") for e in cmds), cmds
    assert any("rozark-test" in e["payload"].get("text", "") for e in outs), outs


def _assert_ws_rejected(aid):
    # server accepts, sends one {"type":"error"} frame, then closes 4409 —
    # drain frames until the disconnect surfaces; no shell ever attaches.
    with client.websocket_connect(f"/ws/sandbox/{aid}") as ws:
        with pytest.raises(WebSocketDisconnect):
            while True:
                ws.receive_text()


def test_ws_rejected_before_start():
    att = _start_attempt()
    _assert_ws_rejected(att["id"])


def test_submit_freezes_sandbox():
    att = _start_attempt()
    aid = att["id"]
    assert client.post(f"/attempts/{aid}/sandbox/start").status_code == 200
    r = client.post(f"/attempts/{aid}/submit", json={"scorer_output": "FS_SCORE: 70%"})
    assert r.status_code == 200
    # the frozen end state was snapshotted into the report timeline
    reasons = [e["payload"].get("reason") for e in r.json()["timeline"]
               if e["type"] == "git_snapshot"]
    assert "candidate_submit" in reasons
    # no new sandbox, no shell, no events after submit
    assert client.post(f"/attempts/{aid}/sandbox/start").status_code == 409
    _assert_ws_rejected(aid)


def test_sandbox_workspaces_are_isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("ROZARK_WORKSPACES", str(tmp_path / "ws"))
    a1, a2 = _start_attempt(), _start_attempt()
    i1 = client.post(f"/attempts/{a1['id']}/sandbox/start").json()
    i2 = client.post(f"/attempts/{a2['id']}/sandbox/start").json()
    # sessions were started by the app-level manager (default root); the
    # two workspace paths must differ per attempt
    assert i1["workspace_path"] != i2["workspace_path"]
    client.post(f"/attempts/{a1['id']}/sandbox/stop")
    client.post(f"/attempts/{a2['id']}/sandbox/stop")
    # env var is read at manager call time for the root in start info
    assert os.path.basename(i1["workspace_path"]) == a1["id"]
