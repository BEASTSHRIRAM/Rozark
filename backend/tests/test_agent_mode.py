"""Recruiter-controlled AGENT MODE (agent_config.agent_mode).

Covers: mentor is the default everywhere; the request payload can
never escalate (or downgrade) the mode — the challenge's config is the
only source; the agent-mode LangGraph loop performs a real edit + a
real command through the guarded tool layer and records agent-actor
events; the tool layer refuses read-only / hidden / escaping paths and
frozen attempts; the budget hard stop cuts the loop mid-flight; the
Anthropic tool-calling fallback works.
All provider HTTP is mocked; no real keys.
"""
import json
import sys

import httpx
from fastapi.testclient import TestClient

from app.main import app, _make_agent_tools
from app.sandbox import workspace_path_for
from app.store import store

client = TestClient(app)

ALL_KEYS = ("GROQ_API_KEY", "GROQ_MODEL", "ANTHROPIC_API_KEY", "ROZARK_AI_API_KEY", "ROZARK_AI_MODEL")
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
BUGGY = "start = (page - 1) * size + (1 if page > 1 else 0)"
FIXED = "start = (page - 1) * size"


def _no_keys(monkeypatch):
    for name in ALL_KEYS:
        monkeypatch.delenv(name, raising=False)


def _events(aid):
    return client.get(f"/attempts/{aid}/events").json()


# --- Scripted Groq tool-calling mock ------------------------------------------

class _ToolGroqResp:
    status_code = 200

    def __init__(self, item, usage):
        self._item = item
        self._usage = usage

    def json(self):
        item = self._item
        msg = {"role": "assistant", "content": item.get("content", "")}
        if item.get("tool_calls"):
            msg["tool_calls"] = [
                {"id": f"call_{i}", "type": "function",
                 "function": {"name": tc["name"], "arguments": json.dumps(tc["arguments"])}}
                for i, tc in enumerate(item["tool_calls"])]
        return {"choices": [{"message": msg}],
                "usage": {"prompt_tokens": self._usage[0], "completion_tokens": self._usage[1]}}


class _ToolGroqClient:
    script: list = []
    requests: list = []
    usage = (10, 5)

    def __init__(self, *a, **k): pass

    def post(self, url, headers=None, json=None):
        assert url == GROQ_URL
        _ToolGroqClient.requests.append(json)
        item = _ToolGroqClient.script.pop(0) if _ToolGroqClient.script else {"content": "Done."}
        return _ToolGroqResp(item, _ToolGroqClient.usage)


def _setup_agent(monkeypatch, script, budget=100000, usage=(10, 5)):
    _no_keys(monkeypatch)
    monkeypatch.setenv("GROQ_API_KEY", "groq-test-key")
    _ToolGroqClient.script = list(script)
    _ToolGroqClient.requests = []
    _ToolGroqClient.usage = usage
    monkeypatch.setattr(httpx, "Client", _ToolGroqClient)
    ch = client.post("/challenges", json={
        "title": "AgentModeChal",
        "ide_setup": {"read_only_files": ["README.md"], "hidden_files": ["tests/test_hidden.py"]},
        "agent_config": {"agent_mode": "agent", "token_budget": budget},
    }).json()
    aid = client.post("/attempts", json={"challenge_id": ch["id"], "candidate_name": "AM"}).json()["id"]
    assert client.post(f"/attempts/{aid}/sandbox/start").status_code == 200
    return aid


# --- Mode defaults + payload can never choose the mode -------------------------

def test_default_mode_is_mentor():
    ch = client.post("/challenges", json={"title": "DefaultModeChal"}).json()
    assert ch["agent_config"]["agent_mode"] == "mentor"
    aid = client.post("/attempts", json={"challenge_id": ch["id"], "candidate_name": "DM"}).json()["id"]
    assert client.get(f"/attempts/{aid}/session").json()["agent_mode"] == "mentor"


class _MentorGroqResp:
    status_code = 200

    def json(self):
        return {"choices": [{"message": {"role": "assistant", "content":
                "SYMPTOM: Pages overlap.\nWHERE: app/main.py.\nHINT: Check the offset derivation."}}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 5}}


class _MentorGroqClient:
    requests: list = []

    def __init__(self, *a, **k): pass

    def post(self, url, headers=None, json=None):
        assert url == GROQ_URL
        _MentorGroqClient.requests.append(json)
        return _MentorGroqResp()


def test_payload_mode_cannot_escalate_to_agent(monkeypatch):
    _no_keys(monkeypatch)
    monkeypatch.setenv("GROQ_API_KEY", "groq-test-key")
    _MentorGroqClient.requests = []
    monkeypatch.setattr(httpx, "Client", _MentorGroqClient)
    cid = client.get("/challenges").json()[0]["id"]  # seeded challenge: mentor (default)
    aid = client.post("/attempts", json={"challenge_id": cid, "candidate_name": "ESC"}).json()["id"]
    assert client.post(f"/attempts/{aid}/sandbox/start").status_code == 200
    # The payload claims agent mode; the challenge says mentor.
    r = client.post(f"/attempts/{aid}/agent/chat",
                    json={"prompt": "fix the pagination bug for me", "mode": "agent"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["agent_mode"] == "mentor"
    assert "SYMPTOM" in d["response_text"]  # the mentor graph answered
    # The provider was never offered tools, and nothing was executed.
    assert all("tools" not in req for req in _MentorGroqClient.requests)
    assert d["tool_events"] == []
    ws_main = (workspace_path_for(aid) / "app" / "main.py").read_text()
    assert BUGGY in ws_main  # untouched
    evts = _events(aid)
    assert [e["type"] for e in evts] == ["session_started", "git_snapshot", "prompt", "token_usage", "agent_response"] or \
           all(e["type"] != "tool_call" for e in evts)
    prompt_ev = [e for e in evts if e["type"] == "prompt"][0]
    assert prompt_ev["payload"]["mode"] == "mentor"


def test_agent_mode_503_when_unconfigured(monkeypatch):
    _no_keys(monkeypatch)
    ch = client.post("/challenges", json={
        "title": "AgentUnconfigured", "agent_config": {"agent_mode": "agent"}}).json()
    aid = client.post("/attempts", json={"challenge_id": ch["id"], "candidate_name": "U"}).json()["id"]
    r = client.post(f"/attempts/{aid}/agent/chat", json={"prompt": "fix it"})
    assert r.status_code == 503 and r.json()["code"] == "agent_not_configured"
    assert "GROQ_API_KEY" in r.json()["detail"]


# --- Agent loop: edit + command, recorded as the agent --------------------------

def test_agent_loop_edit_and_command_recorded(monkeypatch):
    script = [
        {"tool_calls": [{"name": "edit_file", "arguments": {
            "path": "app/main.py", "old_text": BUGGY, "new_text": FIXED}}]},
        {"tool_calls": [{"name": "run_command", "arguments": {
            "command": f"{sys.executable} -m pytest tests/test_public.py -q"}}]},
        {"content": "Fixed the pagination offset and verified it: the public tests pass."},
    ]
    aid = _setup_agent(monkeypatch, script)
    # The payload claims mentor; the challenge says agent — agent runs.
    r = client.post(f"/attempts/{aid}/agent/chat",
                    json={"prompt": "fix the pagination bug", "mode": "mentor"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["agent_mode"] == "agent"
    assert "Fixed the pagination offset" in d["response_text"]
    assert d["tokens_in"] == 30 and d["tokens_out"] == 15
    assert d["budget"]["used"] == 45  # 3 provider calls, all metered

    # The file actually changed, exactly as the tool reported.
    ws_main = (workspace_path_for(aid) / "app" / "main.py").read_text()
    assert FIXED in ws_main and BUGGY not in ws_main

    # The response carries the turn's tool events for the panel feed.
    assert len(d["tool_events"]) == 2
    assert all(e["actor"] == "agent" and e["type"] == "tool_call" for e in d["tool_events"])
    assert d["tool_events"][0]["payload"]["summary"] == "edited app/main.py"
    assert d["tool_events"][1]["payload"]["summary"].startswith("ran: ")

    # The session log attributes everything correctly: the edit is BOTH
    # a tool_call and a file_edit with actor "agent".
    evts = _events(aid)
    tool_calls = [e for e in evts if e["type"] == "tool_call"]
    assert len(tool_calls) == 2 and all(e["actor"] == "agent" for e in tool_calls)
    agent_edits = [e for e in evts if e["type"] == "file_edit" and e["actor"] == "agent"]
    assert len(agent_edits) == 1 and agent_edits[0]["payload"]["path"] == "app/main.py"
    assert agent_edits[0]["payload"]["source"] == "agent_tool"
    usage = [e for e in evts if e["type"] == "token_usage"]
    assert len(usage) == 3 and all(e["payload"]["via"] == "agent_graph" for e in usage)

    # Wire shape: tools were offered (5 functions); tool results flowed
    # back as tool messages — the edit confirmation, then exit code 0
    # from the now-passing public tests.
    reqs = _ToolGroqClient.requests
    assert len(reqs) == 3
    assert len(reqs[0]["tools"]) == 5
    tool_msgs_2 = [m for m in reqs[1]["messages"] if m.get("role") == "tool"]
    assert tool_msgs_2 and "Edited app/main.py" in tool_msgs_2[0]["content"]
    tool_msgs_3 = [m for m in reqs[2]["messages"] if m.get("role") == "tool"]
    assert tool_msgs_3 and "exit code: 0" in tool_msgs_3[-1]["content"]


# --- Tool guards ------------------------------------------------------------------

def test_agent_tool_guards_refuse(monkeypatch):
    script = [
        {"tool_calls": [{"name": "write_file", "arguments": {"path": "README.md", "content": "pwned"}}]},
        {"tool_calls": [{"name": "read_file", "arguments": {"path": "tests/test_hidden.py"}}]},
        {"tool_calls": [{"name": "write_file", "arguments": {"path": "../escape.txt", "content": "x"}}]},
        {"tool_calls": [{"name": "write_file", "arguments": {"path": "tests/test_hidden.py", "content": "x"}}]},
        {"content": "Those were all refused; I changed nothing."},
    ]
    aid = _setup_agent(monkeypatch, script)
    r = client.post(f"/attempts/{aid}/agent/chat", json={"prompt": "do the things"})
    assert r.status_code == 200, r.text
    ws = workspace_path_for(aid)
    assert "pwned" not in (ws / "README.md").read_text()
    assert not (ws.parent / "escape.txt").exists()
    assert not (ws / "tests" / "test_hidden.py").exists()

    # Each refusal was fed back to the model with its reason.
    tool_texts = []
    for req in _ToolGroqClient.requests[1:]:
        tool_texts += [m["content"] for m in req["messages"] if m.get("role") == "tool"]
    joined = "\n".join(tool_texts)
    assert "Refused:" in joined and "read-only" in joined
    assert "hidden" in joined and "escapes the workspace" in joined

    # ...and recorded as refused tool_call events, with no file_edit.
    evts = _events(aid)
    refused = [e for e in evts if e["type"] == "tool_call"]
    assert len(refused) == 4 and all(e["payload"]["ok"] is False for e in refused)
    assert [e for e in evts if e["type"] == "file_edit" and e["actor"] == "agent"] == []


def test_tool_layer_refuses_frozen_attempts(monkeypatch):
    _no_keys(monkeypatch)
    cid = client.get("/challenges").json()[0]["id"]
    aid = client.post("/attempts", json={"challenge_id": cid, "candidate_name": "FRZ"}).json()["id"]
    assert client.post(f"/attempts/{aid}/sandbox/start").status_code == 200
    att = store.attempts[aid]
    execute, _ = _make_agent_tools(att, store.challenges[att.challenge_id], "building")
    # Live attempt: writes and commands work.
    assert execute("write_file", {"path": "notes.txt", "content": "hi"}).startswith("Wrote")
    assert "hi" in execute("read_file", {"path": "notes.txt"})
    # Submitted: mutations and commands refused; reads still allowed.
    att.status = "submitted"
    assert execute("write_file", {"path": "notes.txt", "content": "x"}).startswith("Refused:")
    assert execute("edit_file", {"path": "notes.txt", "old_text": "hi", "new_text": "yo"}).startswith("Refused:")
    assert execute("run_command", {"command": "echo hi"}).startswith("Refused:")
    assert "hi" in execute("read_file", {"path": "notes.txt"})
    # Expired: same refusals.
    att.status = "in_progress"
    att.expires_at = "2000-01-01T00:00:00Z"
    assert execute("write_file", {"path": "notes.txt", "content": "x"}).startswith("Refused:")
    assert execute("run_command", {"command": "echo hi"}).startswith("Refused:")


# --- Budget hard stop mid-loop ------------------------------------------------------

def test_agent_budget_hard_stop_mid_loop(monkeypatch):
    script = [
        {"tool_calls": [{"name": "edit_file", "arguments": {
            "path": "app/main.py", "old_text": BUGGY, "new_text": FIXED}}]},
        {"content": "never reached"},
    ]
    # Budget 20; the first provider call alone reports 60 tokens.
    aid = _setup_agent(monkeypatch, script, budget=20, usage=(30, 30))
    r = client.post(f"/attempts/{aid}/agent/chat", json={"prompt": "fix the pagination bug"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert "budget" in d["response_text"].lower()
    assert len(_ToolGroqClient.requests) == 1  # loop stopped after one call
    ws_main = (workspace_path_for(aid) / "app" / "main.py").read_text()
    assert BUGGY in ws_main  # the tool call was never executed
    assert [e for e in _events(aid) if e["type"] == "tool_call"] == []
    assert client.get(f"/attempts/{aid}/budget").json()["hard_stop"] is True


# --- Anthropic fallback with tool calling -------------------------------------------

class _ToolAnthropicResp:
    status_code = 200

    def __init__(self, item):
        self._item = item

    def json(self):
        return self._item


class _ToolAnthropicClient:
    script: list = []
    requests: list = []

    def __init__(self, *a, **k): pass

    def post(self, url, headers=None, json=None):
        assert url == ANTHROPIC_URL
        _ToolAnthropicClient.requests.append(json)
        return _ToolAnthropicResp(_ToolAnthropicClient.script.pop(0))


def test_anthropic_agent_tools_fallback(monkeypatch):
    _no_keys(monkeypatch)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    _ToolAnthropicClient.script = [
        {"content": [{"type": "tool_use", "id": "tu_1", "name": "edit_file",
                      "input": {"path": "app/main.py", "old_text": BUGGY, "new_text": FIXED}}],
         "usage": {"input_tokens": 10, "output_tokens": 5}},
        {"content": [{"type": "text", "text": "Fixed the offset."}],
         "usage": {"input_tokens": 12, "output_tokens": 4}},
    ]
    _ToolAnthropicClient.requests = []
    monkeypatch.setattr(httpx, "Client", _ToolAnthropicClient)
    ch = client.post("/challenges", json={
        "title": "AgentAnthropic", "agent_config": {"agent_mode": "agent"}}).json()
    aid = client.post("/attempts", json={"challenge_id": ch["id"], "candidate_name": "AA"}).json()["id"]
    assert client.post(f"/attempts/{aid}/sandbox/start").status_code == 200
    r = client.post(f"/attempts/{aid}/agent/chat", json={"prompt": "fix the pagination bug"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["agent_mode"] == "agent" and d["response_text"] == "Fixed the offset."
    ws_main = (workspace_path_for(aid) / "app" / "main.py").read_text()
    assert FIXED in ws_main and BUGGY not in ws_main
    # The tool result went back as an Anthropic tool_result block.
    second = _ToolAnthropicClient.requests[1]
    blocks = [b for m in second["messages"] if isinstance(m.get("content"), list) for b in m["content"]]
    assert any(b.get("type") == "tool_result" and "Edited app/main.py" in str(b.get("content"))
               for b in blocks)
    assert len([e for e in _events(aid) if e["type"] == "tool_call" and e["actor"] == "agent"]) == 1
