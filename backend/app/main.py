import asyncio
import json
import os
import select
import subprocess
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Header, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from .models import *
from .store import store
from .seed import seed
from .scoring import compute_functional_score, compute_collaboration, compute_report_extras, parse_fs_score, parse_junit_xml, parse_tap, parse_junit_cases, parse_tap_cases
from .mentor import run_mentor
from .agent import run_agent, TOOL_SCHEMAS
from .recorder import recorder, BudgetHardStop
from .auth import hash_password, verify_password, create_token, current_user_id
from .sandbox import sandbox_manager, SandboxUnavailable, TerminalInputTap, TerminalOutputTap, workspace_path_for

app=FastAPI(title="Rozark API", version="0.1.0", description="AI-native technical assessment platform (MVP scaffold)")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

seed()  # deterministic at import: TestClient without a context manager may not fire startup events

@app.on_event("startup")
def _startup(): seed()

@app.get("/health")
def health(): return {"status":"ok","service":"rozark"}

# ---------------------------------------------------------------------------
# Auth (docs: app/auth.py). Passwords are pbkdf2-hashed, sessions are
# signed JWTs. Users are in-memory in this increment.
# ---------------------------------------------------------------------------

def _public_user(rec: UserRecord) -> User:
    return User(id=rec.id, company_name=rec.company_name, name=rec.name, email=rec.email)

@app.post("/auth/signup", response_model=AuthResponse, status_code=201)
def signup(body: UserCreate):
    email = body.email.strip().lower()
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(422, "Invalid email address")
    if len(body.password) < 8:
        raise HTTPException(422, "Password must be at least 8 characters")
    if email in store.users:
        raise HTTPException(409, "An account with this email already exists")
    rec = UserRecord(
        id=store.next_user_id(),
        company_name=body.company_name.strip(),
        name=body.name.strip(),
        email=email,
        password_hash=hash_password(body.password),
    )
    store.users[email] = rec
    return AuthResponse(token=create_token(rec.id, rec.email), user=_public_user(rec))

@app.post("/auth/login", response_model=AuthResponse)
def login(body: LoginRequest):
    rec = store.users.get(body.email.strip().lower())
    if not rec or not verify_password(body.password, rec.password_hash):
        raise HTTPException(401, "Invalid email or password")
    return AuthResponse(token=create_token(rec.id, rec.email), user=_public_user(rec))

@app.get("/auth/me", response_model=User)
def me(authorization: str | None = Header(default=None)):
    user_id = current_user_id(authorization)
    for rec in store.users.values():
        if rec.id == user_id:
            return _public_user(rec)
    raise HTTPException(404, "User not found")

def _current_user_record(authorization: str | None) -> UserRecord:
    user_id = current_user_id(authorization)
    for rec in store.users.values():
        if rec.id == user_id: return rec
    raise HTTPException(404, "User not found")

@app.get("/org", response_model=OrgInfo)
def get_org(authorization: str | None = Header(default=None)):
    rec = _current_user_record(authorization)
    members = [u for u in store.users.values() if u.company_name == rec.company_name]
    # Challenges/attempts carry no owner field in this MVP store, so those
    # counts are workspace-wide totals; member_count is truly org-scoped.
    return OrgInfo(company_name=rec.company_name, member_count=len(members),
                   challenge_count=len(store.challenges), attempt_count=len(store.attempts))

@app.get("/org/members", response_model=list[User])
def list_org_members(authorization: str | None = Header(default=None)):
    rec = _current_user_record(authorization)
    return [_public_user(u) for u in store.users.values() if u.company_name == rec.company_name]

@app.patch("/auth/me", response_model=User)
def update_me(body: MeUpdate, authorization: str | None = Header(default=None)):
    rec = _current_user_record(authorization)
    if body.name is not None and body.name.strip(): rec.name = body.name.strip()
    if body.company_name is not None and body.company_name.strip(): rec.company_name = body.company_name.strip()
    store.users[rec.email] = rec  # BlobDict write-through persists the mutation
    return _public_user(rec)

@app.post("/auth/change-password")
def change_password(body: ChangePasswordRequest, authorization: str | None = Header(default=None)):
    rec = _current_user_record(authorization)
    if not verify_password(body.current_password, rec.password_hash):
        raise HTTPException(401, "Current password is incorrect")
    if len(body.new_password) < 8:
        raise HTTPException(422, "New password must be at least 8 characters")
    rec.password_hash = hash_password(body.new_password)
    store.users[rec.email] = rec
    return {"ok": True}

@app.post("/challenges", response_model=Challenge, status_code=201)
def create_challenge(body: ChallengeCreate):
    body.apply_defaults()
    ch=Challenge(id=store.next_challenge_id(), **body.model_dump())
    store.challenges[ch.id]=ch; return ch

@app.get("/challenges", response_model=list[Challenge])
def list_challenges(): return list(store.challenges.values())

@app.get("/challenges/{challenge_id}", response_model=Challenge)
def get_challenge(challenge_id: str):
    ch=store.challenges.get(challenge_id)
    if not ch: raise HTTPException(404,"Challenge not found")
    return ch

@app.put("/challenges/{challenge_id}", response_model=Challenge)
def update_challenge(challenge_id: str, body: ChallengeCreate):
    if challenge_id not in store.challenges: raise HTTPException(404,"Challenge not found")
    body.apply_defaults()
    ch=Challenge(id=challenge_id, **body.model_dump())
    store.challenges[ch.id]=ch; return ch

@app.delete("/challenges/{challenge_id}", status_code=204)
def delete_challenge(challenge_id: str):
    if challenge_id not in store.challenges: raise HTTPException(404,"Challenge not found")
    if any(a.challenge_id==challenge_id for a in store.attempts.values()):
        raise HTTPException(409,"Challenge has attempts and cannot be deleted")
    del store.challenges[challenge_id]
    return Response(status_code=204)

@app.post("/challenges/{challenge_id}/clone", response_model=Challenge, status_code=201)
def clone_challenge(challenge_id: str):
    src=store.challenges.get(challenge_id)
    if not src: raise HTTPException(404,"Challenge not found")
    data=src.model_dump(); data.pop("id", None); data["title"]=src.title+" (copy)"
    ch=Challenge(id=store.next_challenge_id(), **data)
    store.challenges[ch.id]=ch; return ch

@app.get("/challenges/{challenge_id}/attempts", response_model=list[Attempt])
def list_challenge_attempts(challenge_id: str):
    if challenge_id not in store.challenges: raise HTTPException(404,"Challenge not found")
    return [a for a in store.attempts.values() if a.challenge_id==challenge_id]

@app.get("/attempts", response_model=list[Attempt])
def list_attempts(challenge_id: str | None = None, status: str | None = None):
    out=list(store.attempts.values())
    if challenge_id is not None: out=[a for a in out if a.challenge_id==challenge_id]
    if status is not None: out=[a for a in out if a.status==status]
    return out

@app.post("/attempts", response_model=Attempt, status_code=201)
def start_attempt(body: AttemptCreate):
    ch=store.challenges.get(body.challenge_id)
    if not ch: raise HTTPException(404,"Challenge not found")
    att=Attempt(id=store.next_attempt_id(), **body.model_dump())
    att.session_id=att.id
    att.token_budget=ch.agent_config.token_budget
    _now_dt=datetime.now(timezone.utc)
    att.started_at=_now_dt.isoformat().replace("+00:00","Z")
    _limit=ch.agent_config.time_limit_minutes
    if _limit is None: _limit=ch.recommended_time_minutes or 0
    att.time_limit_minutes=int(_limit)
    att.expires_at=(_now_dt+timedelta(minutes=att.time_limit_minutes)).isoformat().replace("+00:00","Z")
    store.attempts[att.id]=att; return att

@app.get("/attempts/{attempt_id}", response_model=Attempt)
def get_attempt(attempt_id: str):
    att=store.attempts.get(attempt_id)
    if not att: raise HTTPException(404,"Attempt not found")
    return att

@app.post("/attempts/{attempt_id}/events", response_model=SessionEvent, status_code=201)
def add_event(attempt_id: str, body: SessionEventCreate):
    att=store.attempts.get(attempt_id)
    if not att: raise HTTPException(404,"Attempt not found")
    if att.status=="submitted": raise HTTPException(409,"Attempt already submitted - session is frozen")
    _maybe_expire(att)
    try:
        return recorder.append(att, body)
    except BudgetHardStop as e:
        raise HTTPException(403, str(e))

@app.post("/attempts/{attempt_id}/events/batch", response_model=EventsBatchResponse, status_code=201)
def add_events_batch(attempt_id: str, body: EventsBatchRequest):
    att=store.attempts.get(attempt_id)
    if not att: raise HTTPException(404,"Attempt not found")
    if att.status=="submitted": raise HTTPException(409,"Attempt already submitted - session is frozen")
    _maybe_expire(att)
    accepted: list[SessionEvent]=[]
    try:
        for item in body.events:
            accepted.append(recorder.append(att, item))
    except BudgetHardStop as e:
        # Events appended before the hard stop stay in the log (recorder
        # persists each append); the batch as a whole is refused with 403.
        raise HTTPException(403, str(e))
    return EventsBatchResponse(accepted=len(accepted), events=accepted)

@app.get("/attempts/{attempt_id}/events", response_model=list[SessionEvent])
def list_events(attempt_id: str, types: str | None = None, actor: str | None = None,
                since_seq: int | None = None, limit: int | None = None, offset: int | None = None):
    att=store.attempts.get(attempt_id)
    if not att: raise HTTPException(404,"Attempt not found")
    out=recorder.ordered_events(att)
    if types:
        wanted={t.strip() for t in types.split(",") if t.strip()}
        out=[e for e in out if e.type.value in wanted]
    if actor:
        out=[e for e in out if e.actor.value==actor]
    if since_seq is not None:
        out=[e for e in out if e.seq>since_seq]
    if offset:
        out=out[offset:]
    if limit is not None:
        out=out[:limit]
    return out

_STREAM_MAP={"terminal_cmd":"terminal","terminal_output":"terminal","terminal":"terminal",
             "file_edit":"files","file_view":"files","git_snapshot":"files",
             "prompt":"agent","tool_call":"agent","agent_response":"agent","token_usage":"agent"}

@app.get("/attempts/{attempt_id}/events/summary", response_model=EventsSummary)
def events_summary(attempt_id: str):
    att=store.attempts.get(attempt_id)
    if not att: raise HTTPException(404,"Attempt not found")
    by_type: dict[str,int]={}; by_actor: dict[str,int]={}
    by_stream: dict[str,int]={"terminal":0,"files":0,"agent":0,"system":0}
    for e in recorder.ordered_events(att):
        by_type[e.type.value]=by_type.get(e.type.value,0)+1
        by_actor[e.actor.value]=by_actor.get(e.actor.value,0)+1
        by_stream[_STREAM_MAP.get(e.type.value,"system")]+=1
    return EventsSummary(total=len(att.events), by_type=by_type, by_actor=by_actor, by_stream=by_stream)

@app.get("/attempts/{attempt_id}/replay", response_model=Replay)
def get_replay(attempt_id: str):
    att=store.attempts.get(attempt_id)
    if not att: raise HTTPException(404,"Attempt not found")
    events=recorder.ordered_events(att)
    snapshots=[{**e.payload,"event_id":e.id,"seq":e.seq,"ts":e.ts} for e in events if e.type==EventType.git_snapshot]
    return Replay(attempt_id=att.id, session_id=att.session_id or att.id, status=att.status, events=events, git_snapshots=snapshots, token_budget=recorder.budget_summary(att))

@app.get("/attempts/{attempt_id}/budget", response_model=TokenBudgetSummary)
def get_budget(attempt_id: str):
    att=store.attempts.get(attempt_id)
    if not att: raise HTTPException(404,"Attempt not found")
    return recorder.budget_summary(att)

# ---------------------------------------------------------------------------
# Scoring runs (B7, restored): run the challenge's scoring/test command
# inside the workspace, parse the output with the same parsers as
# submit-time scoring, persist every run, and let submit fall back to
# the latest run.
# ---------------------------------------------------------------------------

def _score_runs_for(attempt_id: str) -> list[ScoreRun]:
    return [r for r in store.scoreruns.values() if r.attempt_id == attempt_id]

@app.post("/attempts/{attempt_id}/score/run", response_model=ScoreRun)
def run_score(attempt_id: str):
    att=store.attempts.get(attempt_id)
    if not att: raise HTTPException(404,"Attempt not found")
    ws=workspace_path_for(att.id)
    if not ws.is_dir(): raise HTTPException(409,"sandbox not started")
    ch=store.challenges.get(att.challenge_id)
    if not ch: raise HTTPException(404,"Challenge not found")
    if ch.scoring.mode.value=="custom" and ch.scoring.scoring_command:
        command=ch.scoring.scoring_command
    elif ch.scoring.scoring_command:
        command=ch.scoring.scoring_command
    else:
        command=ch.ide_setup.test_command
    try: timeout=int(os.environ.get("ROZARK_SCORE_TIMEOUT") or 120)
    except ValueError: timeout=120
    exit_code=0; stdout=""
    try:
        proc=subprocess.run(command, shell=True, cwd=str(ws), capture_output=True, text=True, timeout=timeout)
        exit_code=proc.returncode; stdout=proc.stdout or ""
    except subprocess.TimeoutExpired as e:
        exit_code=-1
        out=e.output or ""
        stdout=out.decode(errors="replace") if isinstance(out, bytes) else out
    score=0.0; source="none"; cases=[]
    fs=parse_fs_score(stdout)
    if fs is not None:
        score=fs; source="fs_score"
    else:
        xml_text=None
        for rel in ch.scoring.scoring_output_files:
            if rel.endswith(".xml") and (ws/rel).is_file():
                try: xml_text=(ws/rel).read_text(encoding="utf-8", errors="replace")
                except OSError: xml_text=None
                break
        if xml_text is not None:
            score=parse_junit_xml(xml_text); source="junit"; cases=parse_junit_cases(xml_text)
        elif ch.scoring.format.value=="tap":
            score=parse_tap(stdout); source="tap"; cases=parse_tap_cases(stdout)
        elif stdout.strip().startswith("<"):
            score=parse_junit_xml(stdout); source="junit"; cases=parse_junit_cases(stdout)
    run=ScoreRun(id=store._next("scorerun","run"), attempt_id=att.id, command=command,
                 exit_code=exit_code, score=score, source=source,
                 stdout_tail=stdout[-2000:], ran_at=datetime.now(timezone.utc).isoformat().replace("+00:00","Z"),
                 tests=[TestCaseResult(**c) for c in cases])
    store.scoreruns[run.id]=run
    try:
        recorder.append(att, SessionEventCreate(type=EventType.test_run, actor=Actor.system, payload={"command": command, "exit_code": exit_code, "score": score, "source": source, "via": "score_run"}))
    except Exception: pass
    return run

@app.get("/attempts/{attempt_id}/score", response_model=ScoreRunHistory)
def get_score(attempt_id: str):
    att=store.attempts.get(attempt_id)
    if not att: raise HTTPException(404,"Attempt not found")
    runs=_score_runs_for(att.id)
    return ScoreRunHistory(attempt_id=att.id, latest=runs[-1] if runs else None, runs=runs)

# ---------------------------------------------------------------------------
# Agent budget proxy: the ONLY path from a candidate session to a model
# API. The key never reaches the browser/sandbox; every call is recorded
# (prompt -> token_usage -> agent_response) and the recorder's hard stop
# refuses agent activity once the token cap is hit. What sits behind it
# is chosen by the challenge's recruiter-set agent_config.agent_mode:
# the LangGraph MENTOR graph (app/mentor.py, diagnose-only) or the
# LangGraph AGENT graph (app/agent.py, guarded tools) — see agent_chat.
#
# Provider selection (first configured wins):
#   1. Groq — GROQ_API_KEY set: OpenAI-compatible chat completions at
#      api.groq.com, model from GROQ_MODEL (default openai/gpt-oss-120b).
#   2. Anthropic — ROZARK_AI_API_KEY or ANTHROPIC_API_KEY set (fallback).
# Neither -> /agent/status reports configured=False and chat returns a
# graceful 503; the rest of the platform keeps working.
# ---------------------------------------------------------------------------

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b"
DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5"

def _agent_provider(challenge=None):
    """Return (provider, api_key, model) for the first configured provider.

    Unconfigured returns provider "groq" (the default Rozark now expects)
    with an empty key, so /agent/status has a stable shape.
    """
    groq_key = os.environ.get("GROQ_API_KEY") or ""
    if groq_key:
        return "groq", groq_key, os.environ.get("GROQ_MODEL") or DEFAULT_GROQ_MODEL
    anthropic_key = os.environ.get("ROZARK_AI_API_KEY") or os.environ.get("ANTHROPIC_API_KEY") or ""
    if anthropic_key:
        if challenge is not None and challenge.agent_config.model:
            model = challenge.agent_config.model
        else:
            model = os.environ.get("ROZARK_AI_MODEL") or DEFAULT_ANTHROPIC_MODEL
        return "anthropic", anthropic_key, model
    return "groq", "", os.environ.get("GROQ_MODEL") or DEFAULT_GROQ_MODEL

def _usage_int(value) -> int:
    try: return max(0, int(value or 0))
    except (TypeError, ValueError): return 0

def _provider_post(url, headers, payload):
    try:
        http = httpx.Client(timeout=60)
        return http.post(url, headers=headers, json=payload)
    except (httpx.HTTPError, httpx.InvalidURL, ValueError) as e:
        # InvalidURL (a bare Exception in this httpx version) is raised at
        # Client() time when the ambient proxy env is malformed — a
        # provider/config failure must surface as the designed 502, not a
        # bare 500.
        raise HTTPException(502, f"Agent provider request failed: {e}")

def _provider_json(resp) -> dict:
    if resp.status_code != 200:
        raise HTTPException(502, f"Agent provider returned HTTP {resp.status_code}")
    try: return resp.json()
    except ValueError: raise HTTPException(502, "Agent provider returned invalid JSON")

def _call_groq(key, model, system_prompt, prompt, max_tokens=1024):
    resp = _provider_post(GROQ_API_URL,
                          {"Authorization": f"Bearer {key}", "content-type": "application/json"},
                          {"model": model, "max_tokens": max_tokens,
                           "messages": [{"role": "system", "content": system_prompt},
                                        {"role": "user", "content": prompt}]})
    data = _provider_json(resp)
    choices = data.get("choices") or []
    text = ""
    if choices and isinstance(choices[0], dict):
        text = str((choices[0].get("message") or {}).get("content") or "")
    usage = data.get("usage", {}) or {}
    return text, _usage_int(usage.get("prompt_tokens")), _usage_int(usage.get("completion_tokens"))

def _call_anthropic(key, model, system_prompt, prompt, max_tokens=1024):
    resp = _provider_post(ANTHROPIC_API_URL,
                          {"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                          {"model": model, "max_tokens": max_tokens, "system": system_prompt,
                           "messages": [{"role": "user", "content": prompt}]})
    data = _provider_json(resp)
    text = "".join(str(b.get("text", "")) for b in data.get("content", []) if isinstance(b, dict) and b.get("type") == "text")
    usage = data.get("usage", {}) or {}
    return text, _usage_int(usage.get("input_tokens")), _usage_int(usage.get("output_tokens"))

def _agent_mode_of(ch) -> str:
    """The attempt's effective side-panel mode: the CHALLENGE's
    recruiter-set agent_config.agent_mode, defaulting to "mentor".
    This is the only source of the mode — request payloads never are."""
    if ch is None:
        return "mentor"
    m = ch.agent_config.agent_mode
    v = m.value if isinstance(m, AgentMode) else str(m or "mentor")
    return v if v in ("mentor", "agent") else "mentor"

# ---------------------------------------------------------------------------
# Tool-calling providers for AGENT mode (app/agent.py). The graph speaks
# a normalised conversation shape; the two functions below convert
# to/from each provider's wire format:
#   message: {"role": "system"|"user", "content": str}
#          | {"role": "assistant", "content": str,
#             "tool_calls": [{"id", "name", "arguments": dict}]}
#          | {"role": "tool", "tool_call_id": str, "name": str,
#             "content": str}
# Both configured providers support tool calling (Groq via its
# OpenAI-compatible functions format, Anthropic via tool_use blocks);
# usage from EVERY call is returned for budget metering by the caller.
# ---------------------------------------------------------------------------

def _parse_tool_arguments(raw) -> dict:
    if isinstance(raw, dict):
        return raw
    try:
        parsed = json.loads(raw or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except (ValueError, TypeError):
        return {}

def _call_groq_tools(key, model, messages, tools, offer_tools, max_tokens=2048):
    wire = []
    for m in messages:
        role = m.get("role")
        if role in ("system", "user"):
            wire.append({"role": role, "content": str(m.get("content") or "")})
        elif role == "assistant":
            entry = {"role": "assistant", "content": str(m.get("content") or "")}
            calls = []
            for i, tc in enumerate(m.get("tool_calls") or []):
                calls.append({"id": str(tc.get("id") or f"call_{i}"), "type": "function",
                              "function": {"name": str(tc.get("name") or ""),
                                           "arguments": json.dumps(tc.get("arguments") or {})}})
            if calls:
                entry["tool_calls"] = calls
            wire.append(entry)
        elif role == "tool":
            wire.append({"role": "tool", "tool_call_id": str(m.get("tool_call_id") or ""),
                         "content": str(m.get("content") or "")})
    payload = {"model": model, "max_tokens": max_tokens, "messages": wire}
    if offer_tools and tools:
        payload["tools"] = [{"type": "function",
                             "function": {"name": t["name"], "description": t["description"],
                                          "parameters": t["parameters"]}} for t in tools]
        payload["tool_choice"] = "auto"
    resp = _provider_post(GROQ_API_URL,
                          {"Authorization": f"Bearer {key}", "content-type": "application/json"},
                          payload)
    data = _provider_json(resp)
    choices = data.get("choices") or []
    msg = (choices[0].get("message") or {}) if choices and isinstance(choices[0], dict) else {}
    calls = []
    for i, tc in enumerate(msg.get("tool_calls") or []):
        fn = tc.get("function") or {}
        calls.append({"id": str(tc.get("id") or f"call_{i}"), "name": str(fn.get("name") or ""),
                      "arguments": _parse_tool_arguments(fn.get("arguments"))})
    usage = data.get("usage", {}) or {}
    return {"content": str(msg.get("content") or ""), "tool_calls": calls,
            "tokens_in": _usage_int(usage.get("prompt_tokens")),
            "tokens_out": _usage_int(usage.get("completion_tokens"))}

def _call_anthropic_tools(key, model, messages, tools, offer_tools, max_tokens=2048):
    system = "\n\n".join(str(m.get("content") or "") for m in messages if m.get("role") == "system")
    wire = []
    for m in messages:
        role = m.get("role")
        if role == "system":
            continue
        if role == "user":
            wire.append({"role": "user", "content": str(m.get("content") or "")})
        elif role == "assistant":
            blocks = []
            if m.get("content"):
                blocks.append({"type": "text", "text": str(m["content"])})
            for tc in m.get("tool_calls") or []:
                blocks.append({"type": "tool_use", "id": str(tc.get("id") or ""),
                               "name": str(tc.get("name") or ""),
                               "input": tc.get("arguments") or {}})
            wire.append({"role": "assistant", "content": blocks or [{"type": "text", "text": ""}]})
        elif role == "tool":
            block = {"type": "tool_result", "tool_use_id": str(m.get("tool_call_id") or ""),
                     "content": str(m.get("content") or "")}
            if wire and wire[-1]["role"] == "user" and isinstance(wire[-1]["content"], list):
                wire[-1]["content"].append(block)
            else:
                wire.append({"role": "user", "content": [block]})
    payload = {"model": model, "max_tokens": max_tokens, "messages": wire}
    if system:
        payload["system"] = system
    if offer_tools and tools:
        payload["tools"] = [{"name": t["name"], "description": t["description"],
                             "input_schema": t["parameters"]} for t in tools]
    resp = _provider_post(ANTHROPIC_API_URL,
                          {"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                          payload)
    data = _provider_json(resp)
    text_parts = []
    calls = []
    for b in data.get("content", []) or []:
        if not isinstance(b, dict):
            continue
        if b.get("type") == "text":
            text_parts.append(str(b.get("text", "")))
        elif b.get("type") == "tool_use":
            calls.append({"id": str(b.get("id") or ""), "name": str(b.get("name") or ""),
                          "arguments": b.get("input") if isinstance(b.get("input"), dict) else {}})
    usage = data.get("usage", {}) or {}
    return {"content": "".join(text_parts), "tool_calls": calls,
            "tokens_in": _usage_int(usage.get("input_tokens")),
            "tokens_out": _usage_int(usage.get("output_tokens"))}

@app.get("/agent/status", response_model=AgentStatus)
def agent_status():
    provider, key, model = _agent_provider()
    return AgentStatus(configured=bool(key), provider=provider, model=model)

# ---------------------------------------------------------------------------
# Public tests (mentor-era feedback ceiling): named PUBLIC tests with
# their latest status and, for failures, the Expected-vs-Received detail
# from the latest scoring run. Hidden tests are exposed ONLY as counts —
# never names, never assertions (the classic-question model in REPORT2).
# ---------------------------------------------------------------------------

def _is_hidden_test(ch, case: TestCaseResult) -> bool:
    if ch is None: return False
    if case.name in (ch.scoring.hidden_tests or []): return True
    hidden_stems = set()
    for entry in ch.ide_setup.hidden_files or []:
        base = entry.replace("\\", "/").rstrip("/").split("/")[-1]
        if base.endswith(".py"): base = base[:-3]
        hidden_stems.add(base)
    if not hidden_stems: return False
    module = (case.classname or "").replace("/", ".").split(".")[-1]
    return module in hidden_stems

def _public_tests_for(att: Attempt) -> PublicTestsResponse:
    ch = store.challenges.get(att.challenge_id)
    runs = _score_runs_for(att.id)
    if not runs:
        return PublicTestsResponse(attempt_id=att.id)
    latest = runs[-1]
    public: list[PublicTestItem] = []
    hidden_total = 0; hidden_passed = 0
    for case in latest.tests:
        if _is_hidden_test(ch, case):
            hidden_total += 1
            if case.status == "passed": hidden_passed += 1
        else:
            public.append(PublicTestItem(name=case.name, status=case.status,
                                         expected=case.expected, received=case.received,
                                         message=case.message))
    return PublicTestsResponse(attempt_id=att.id, run_id=latest.id, tests=public,
                               hidden=HiddenTestsSummary(total=hidden_total, passed=hidden_passed))

@app.get("/attempts/{attempt_id}/tests/public", response_model=PublicTestsResponse)
def public_tests(attempt_id: str):
    att = store.attempts.get(attempt_id)
    if not att: raise HTTPException(404, "Attempt not found")
    return _public_tests_for(att)

# ---------------------------------------------------------------------------
# Agent-mode tool layer: the ONLY hands the full agent has. Every guard
# the files API enforces is enforced again here, in the tool layer
# itself — workspace scoping via _safe_ws_path, hidden files refused,
# read-only files refused, and submitted/expired attempts refuse all
# mutations and commands. Refusals return text for the model (they
# never raise). Every call is recorded as a tool_call session event
# with actor "agent"; file mutations additionally emit the recorder's
# file_edit shape, also actor "agent", so report/replay distinguish AI
# actions from candidate actions.
# ---------------------------------------------------------------------------

class _ToolRefusal(Exception):
    """A guard refusal — its message is the reason fed back to the model."""

def _make_agent_tools(att: Attempt, ch, phase: str):
    """Return (execute_tool, tool_events) for one agent-mode chat turn."""
    tool_events: list[SessionEvent] = []
    ws = workspace_path_for(att.id)

    def _frozen_reason() -> str | None:
        if att.status == "submitted":
            return "the attempt is submitted and its workspace is frozen"
        exp = _parse_iso(att.expires_at)
        if att.status == "in_progress" and exp is not None and datetime.now(timezone.utc) > exp:
            return "the attempt has expired and its workspace is frozen"
        return None

    def _resolve(raw) -> tuple[Path, str]:
        try:
            target = _safe_ws_path(ws, str(raw or ""))
        except HTTPException as e:
            raise _ToolRefusal(str(e.detail))
        return target, target.relative_to(ws.resolve()).as_posix()

    def _record(name: str, args: dict, summary: str, result_text: str, ok: bool,
                file_event: SessionEventCreate | None = None):
        args_summary = {k: str(v)[:200] for k, v in (args or {}).items()
                        if k in ("path", "command")}
        payload = {"tool": name, "via": "agent_graph", "phase": phase,
                   "args": args_summary, "summary": summary,
                   "result": result_text[:300], "ok": ok}
        try:
            ev = recorder.append(att, SessionEventCreate(
                type=EventType.tool_call, actor=Actor.agent, payload=payload))
            tool_events.append(ev)
        except BudgetHardStop:
            pass
        if file_event is not None:
            try:
                recorder.append(att, file_event)
            except BudgetHardStop:
                pass

    def _list_files(args):
        lines = []
        for path in sorted(ws.rglob("*")):
            rel = path.relative_to(ws).as_posix()
            parts = set(path.relative_to(ws).parts)
            if ".git" in parts or "__pycache__" in parts or path.is_dir():
                continue
            ro, hid = _file_flags(att, rel)
            if hid:
                continue  # hidden files are never listed to the agent
            lines.append(f"{rel} ({path.stat().st_size} bytes)" + (" [read-only]" if ro else ""))
            if len(lines) >= 200:
                lines.append("… (listing truncated at 200 files)")
                break
        return ("\n".join(lines) if lines else "(workspace is empty)"), \
            f"listed {min(len(lines), 200)} workspace files", True, None

    def _read_file(args):
        target, rel = _resolve(args.get("path"))
        _ro, hid = _file_flags(att, rel)
        if hid:
            raise _ToolRefusal(f"{rel} is a hidden file and cannot be read")
        if not target.is_file():
            return f"Error: {rel} does not exist in the workspace.", f"read {rel} — not found", False, None
        try:
            content = target.read_text(encoding="utf-8", errors="replace")
        except OSError as e:
            return f"Error: could not read {rel}: {e}", f"read {rel} — error", False, None
        if len(content) > 8000:
            content = content[:8000] + "\n…[truncated at 8000 chars]"
        return content, f"read {rel}", True, None

    def _write_file(args):
        if (reason := _frozen_reason()):
            raise _ToolRefusal(reason)
        target, rel = _resolve(args.get("path"))
        ro, hid = _file_flags(att, rel)
        if hid:
            raise _ToolRefusal(f"{rel} is a hidden file and cannot be written")
        if ro:
            raise _ToolRefusal(f"{rel} is read-only and cannot be written")
        content = args.get("content")
        if not isinstance(content, str):
            return "Error: write_file requires a string 'content'.", f"write {rel} — error", False, None
        existed = target.is_file()
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        fev = SessionEventCreate(type=EventType.file_edit, actor=Actor.agent,
                                 payload={"path": rel,
                                          "change": "modified" if existed else "created",
                                          "source": "agent_tool"})
        verb = "edited" if existed else "created"
        return f"Wrote {rel} ({len(content)} chars).", f"{verb} {rel}", True, fev

    def _edit_file(args):
        if (reason := _frozen_reason()):
            raise _ToolRefusal(reason)
        target, rel = _resolve(args.get("path"))
        ro, hid = _file_flags(att, rel)
        if hid:
            raise _ToolRefusal(f"{rel} is a hidden file and cannot be edited")
        if ro:
            raise _ToolRefusal(f"{rel} is read-only and cannot be edited")
        if not target.is_file():
            return f"Error: {rel} does not exist in the workspace.", f"edited {rel} — not found", False, None
        old, new = args.get("old_text"), args.get("new_text")
        if not isinstance(old, str) or not isinstance(new, str) or not old:
            return "Error: edit_file requires non-empty string 'old_text' and string 'new_text'.", \
                f"edited {rel} — error", False, None
        text = target.read_text(encoding="utf-8", errors="replace")
        count = text.count(old)
        if count == 0:
            return f"Error: old_text was not found in {rel}; no change made.", \
                f"edited {rel} — no match", False, None
        if count > 1:
            return (f"Error: old_text occurs {count} times in {rel}; include more "
                    f"context so it matches exactly once. No change made."), \
                f"edited {rel} — ambiguous", False, None
        target.write_text(text.replace(old, new, 1), encoding="utf-8")
        fev = SessionEventCreate(type=EventType.file_edit, actor=Actor.agent,
                                 payload={"path": rel, "change": "modified",
                                          "source": "agent_tool"})
        return f"Edited {rel}: replaced the matched text.", f"edited {rel}", True, fev

    def _run_command(args):
        if (reason := _frozen_reason()):
            raise _ToolRefusal(reason)
        cmd = str(args.get("command") or "").strip()
        if not cmd:
            return "Error: run_command requires a non-empty 'command'.", "ran: (empty)", False, None
        try:
            timeout = int(os.environ.get("ROZARK_AGENT_CMD_TIMEOUT") or 30)
        except ValueError:
            timeout = 30
        exit_code = None
        try:
            proc = subprocess.run(cmd, shell=True, cwd=str(ws), capture_output=True,
                                  text=True, timeout=timeout)
            out = (proc.stdout or "") + (proc.stderr or "")
            exit_code = proc.returncode
        except subprocess.TimeoutExpired as e:
            raw = e.output or ""
            out = raw.decode(errors="replace") if isinstance(raw, bytes) else str(raw)
            out += f"\n[command timed out after {timeout}s and was killed]"
        if len(out) > 4000:
            out = out[:2000] + "\n…[output truncated]…\n" + out[-1000:]
        result = f"exit code: {exit_code}\n{out}".strip() if out.strip() else \
            f"exit code: {exit_code} (no output)"
        return result, f"ran: {cmd[:80]}", True, None

    _HANDLERS = {"list_files": _list_files, "read_file": _read_file,
                 "write_file": _write_file, "edit_file": _edit_file,
                 "run_command": _run_command}

    def execute_tool(name: str, args: dict) -> str:
        args = args if isinstance(args, dict) else {}
        handler = _HANDLERS.get(name)
        if handler is None:
            text = f"Error: unknown tool '{name}'."
            _record(name, args, f"{name} — unknown tool", text, False)
            return text
        if not ws.is_dir():
            text = "Refused: the sandbox workspace is not started yet."
            _record(name, args, f"{name} refused: workspace not started", text, False)
            return text
        if att.budget_hard_stop and name in ("write_file", "edit_file", "run_command"):
            # Defence in depth (the graph also stops): once the token
            # hard stop is active, no mutation or command may run —
            # its tool_call event could no longer be recorded.
            text = "Refused: the token budget hard stop is active for this attempt."
            _record(name, args, f"{name} refused: budget hard stop", text, False)
            return text
        try:
            text, summary, ok, fev = handler(args)
        except _ToolRefusal as r:
            text, summary, ok, fev = f"Refused: {r}", f"{name} refused: {r}"[:200], False, None
        except Exception as e:
            text, summary, ok, fev = f"Error: tool failed: {e}", f"{name} — error", False, None
        _record(name, args, summary, text, ok, fev)
        return text

    return execute_tool, tool_events

# ---------------------------------------------------------------------------
# Mentor context: what the mentor graph reads (READ-ONLY). In mentor
# mode the panel diagnoses (SYMPTOM / WHERE / HINT), never solves, and
# has no file-write or command capability. Context gathering below is
# READ-ONLY.
# ---------------------------------------------------------------------------

def _mentor_context(att: Attempt, ch) -> dict:
    ctx = {"brief": "", "files": "", "events": "", "tests": ""}
    if ch is not None:
        ctx["brief"] = (ch.problem_description or "")[:800]
    # Workspace excerpts (read-only; hidden files are never read).
    try:
        ws = workspace_path_for(att.id)
        if ws.is_dir():
            chunks: list[str] = []
            budget = 4000
            for path in sorted(ws.rglob("*")):
                if budget <= 0: break
                rel = path.relative_to(ws).as_posix()
                parts = set(path.relative_to(ws).parts)
                if ".git" in parts or "__pycache__" in parts or not path.is_file(): continue
                _ro, hid = _file_flags(att, rel)
                if hid: continue
                try: text = path.read_text(encoding="utf-8", errors="replace")
                except OSError: continue
                excerpt = "\n".join(text.splitlines()[:30])[:1200]
                chunks.append(f"--- {rel} ---\n{excerpt}")
                budget -= len(excerpt)
            ctx["files"] = "\n\n".join(chunks)
    except Exception:
        pass
    # Recent session evidence (errors and runs first-class).
    lines = []
    for e in recorder.ordered_events(att)[-12:]:
        p = e.payload or {}
        detail = ""
        for k in ("command", "path", "text", "error"):
            if p.get(k):
                detail = f"{k}={str(p[k])[:200]}"
                break
        lines.append(f"[{e.type.value}] {detail}".rstrip())
    ctx["events"] = "\n".join(lines)
    # Latest public test results (hidden tests never enter mentor context).
    pub = _public_tests_for(att)
    if pub.run_id:
        tlines = []
        for t in pub.tests:
            mark = "PASS" if t.status == "passed" else t.status.upper()
            line = f"{mark}: {t.name}"
            if t.status in ("failed", "error") and (t.expected or t.received):
                line += f" — expected {t.expected}, received {t.received}"
            tlines.append(line)
        if pub.hidden.total:
            tlines.append(f"({pub.hidden.total} hidden tests also ran; their details are never shown.)")
        ctx["tests"] = "\n".join(tlines)
    return ctx

# ---------------------------------------------------------------------------
# Side-panel chat: ONE endpoint, TWO graphs, chosen by the CHALLENGE —
# never by the request. agent_config.agent_mode == "mentor" (default)
# routes to the LangGraph mentor (diagnose-only, read-only context,
# guardrailed). "agent" routes to the LangGraph full agent
# (app/agent.py), which may edit files and run commands through the
# guarded tool layer above. A mode claimed in the request payload is
# ignored entirely.
# ---------------------------------------------------------------------------

def _agent_chat_agent(att: Attempt, ch, body: AgentChatRequest,
                      provider: str, key: str, model: str) -> AgentChatResponse:
    """Full-agent turn: run the LangGraph agent loop with metering."""
    execute_tool, tool_events = _make_agent_tools(att, ch, body.phase)

    def _call_llm_tools(messages, offer_tools):
        if provider == "groq":
            out = _call_groq_tools(key, model, messages, TOOL_SCHEMAS, offer_tools)
        else:
            out = _call_anthropic_tools(key, model, messages, TOOL_SCHEMAS, offer_tools)
        # Meter EVERY provider call into the same budget the mentor uses;
        # the recorder flips the hard stop the moment the cap is crossed
        # (token_usage appends themselves never raise).
        recorder.append(att, SessionEventCreate(
            type=EventType.token_usage, actor=Actor.system,
            payload={"tokens_in": out["tokens_in"], "tokens_out": out["tokens_out"],
                     "phase": body.phase, "via": "agent_graph",
                     "provider": provider, "model": model}))
        return out

    result = run_agent(
        call_llm_tools=_call_llm_tools, execute_tool=execute_tool,
        budget_exceeded=lambda: att.budget_hard_stop,
        prompt=body.prompt, phase=body.phase,
        challenge_title=ch.title if ch else att.challenge_id,
        brief=(ch.problem_description or "")[:800] if ch else "")
    text = str(result.get("final_text") or "")
    try:
        recorder.append(att, SessionEventCreate(
            type=EventType.agent_response, actor=Actor.agent,
            payload={"text": text, "phase": body.phase, "via": "agent_graph",
                     "mode": "agent", "tool_calls": len(tool_events),
                     "stopped": result.get("stopped") or "done"}))
    except BudgetHardStop:
        pass  # the turn's work is recorded; the reply still returns
    return AgentChatResponse(
        response_text=text,
        tokens_in=int(result.get("tokens_in") or 0),
        tokens_out=int(result.get("tokens_out") or 0),
        budget=recorder.budget_summary(att), agent_mode="agent",
        tool_events=tool_events)

@app.post("/attempts/{attempt_id}/agent/chat", response_model=AgentChatResponse)
def agent_chat(attempt_id: str, body: AgentChatRequest):
    att = store.attempts.get(attempt_id)
    if not att: raise HTTPException(404, "Attempt not found")
    if att.status == "submitted": raise HTTPException(409, "Attempt already submitted - session is frozen")
    if att.budget_hard_stop:
        raise HTTPException(403, f"Token budget hard stop is active for attempt {att.id} ({att.tokens_used}/{att.token_budget} tokens used).")
    ch = store.challenges.get(att.challenge_id)
    # The mode comes from the challenge's recruiter-set config ONLY.
    mode = _agent_mode_of(ch)
    provider, key, model = _agent_provider(ch)
    if not key:
        label = "AI agent" if mode == "agent" else "Mentor"
        return JSONResponse(status_code=503, content={"detail": f"{label} is not configured: set GROQ_API_KEY (or ANTHROPIC_API_KEY) on the backend.", "code": "agent_not_configured"})
    try:
        recorder.append(att, SessionEventCreate(type=EventType.prompt, actor=Actor.candidate, payload={"text": body.prompt, "phase": body.phase, "mode": mode, "via": "agent_graph" if mode == "agent" else "mentor_graph"}))
    except BudgetHardStop as e:
        raise HTTPException(403, str(e))
    if mode == "agent":
        return _agent_chat_agent(att, ch, body, provider, key, model)

    def _call_llm(system_prompt: str, user_prompt: str):
        if provider == "groq":
            return _call_groq(key, model, system_prompt, user_prompt, max_tokens=2048)
        return _call_anthropic(key, model, system_prompt, user_prompt, max_tokens=2048)

    result = run_mentor(
        gather_context=lambda: _mentor_context(att, ch),
        call_llm=_call_llm,
        prompt=body.prompt, phase=body.phase,
        challenge_title=ch.title if ch else att.challenge_id)
    tokens_in = int(result.get("tokens_in") or 0)
    tokens_out = int(result.get("tokens_out") or 0)
    recorder.append(att, SessionEventCreate(type=EventType.token_usage, actor=Actor.system, payload={"tokens_in": tokens_in, "tokens_out": tokens_out, "phase": body.phase, "via": "mentor_graph", "provider": provider, "model": model, "llm_calls": int(result.get("llm_calls") or 1)}))
    if result.get("guardrail_action") not in (None, "", "pass"):
        try:
            recorder.append(att, SessionEventCreate(type=EventType.mentor_guardrail, actor=Actor.system, payload={"action": result.get("guardrail_action"), "violations": result.get("violations") or [], "phase": body.phase, "via": "mentor_graph"}))
        except BudgetHardStop:
            pass
    text = str(result.get("reply") or "")
    recorder.append(att, SessionEventCreate(type=EventType.agent_response, actor=Actor.agent, payload={"text": text, "phase": body.phase, "via": "mentor_graph", "symptom": result.get("symptom", ""), "where": result.get("where", ""), "hint": result.get("hint", "")}))
    return AgentChatResponse(response_text=text, tokens_in=tokens_in, tokens_out=tokens_out,
                             budget=recorder.budget_summary(att),
                             symptom=str(result.get("symptom") or ""), where=str(result.get("where") or ""),
                             hint=str(result.get("hint") or ""),
                             guardrail_intervened=result.get("guardrail_action") not in (None, "", "pass"))

# ---------------------------------------------------------------------------
# Workspace files (B5, restored): the editor's view of the sandbox
# workspace. Reads and writes go through the recorder so file_view /
# file_edit land in the same ordered event log as everything else.
# Hidden files are never served; read-only files are never written.
# Before the sandbox starts there is no workspace: 409, which the
# attempt page treats as its "no workspace yet" state.
# ---------------------------------------------------------------------------

def _ws_or_409(att: Attempt):
    ws = workspace_path_for(att.id)
    if not ws.is_dir():
        raise HTTPException(409, "sandbox not started")
    return ws

def _safe_ws_path(ws, raw: str):
    if not raw or not raw.strip():
        raise HTTPException(400, "path is required")
    target = (ws / raw).resolve()
    root = ws.resolve()
    if target != root and root not in target.parents:
        raise HTTPException(400, "path escapes the workspace")
    return target

def _file_flags(att: Attempt, rel: str) -> tuple[bool, bool]:
    ch = store.challenges.get(att.challenge_id)
    if not ch: return (False, False)
    def _hit(entries):
        for e in entries:
            e = e.strip("/")
            if rel == e or rel.startswith(e + "/"): return True
        return False
    hidden = _hit(ch.ide_setup.hidden_files)
    read_only = _hit(ch.ide_setup.read_only_files)
    return (read_only, hidden)

@app.get("/attempts/{attempt_id}/files", response_model=FileListResponse)
def list_files(attempt_id: str):
    att=store.attempts.get(attempt_id)
    if not att: raise HTTPException(404,"Attempt not found")
    ws=_ws_or_409(att)
    files=[]
    for path in sorted(ws.rglob("*")):
        rel=path.relative_to(ws).as_posix()
        parts=set(path.relative_to(ws).parts)
        if ".git" in parts or "__pycache__" in parts or path.is_dir(): continue
        ro, hid=_file_flags(att, rel)
        files.append(WorkspaceFile(path=rel, size=path.stat().st_size, read_only=ro, hidden=hid))
    return FileListResponse(attempt_id=att.id, files=files)

@app.get("/attempts/{attempt_id}/files/content", response_model=FileContentResponse)
def read_file_content(attempt_id: str, path: str = ""):
    att=store.attempts.get(attempt_id)
    if not att: raise HTTPException(404,"Attempt not found")
    ws=_ws_or_409(att)
    target=_safe_ws_path(ws, path)
    rel=target.relative_to(ws.resolve()).as_posix()
    ro, hid=_file_flags(att, rel)
    if hid: raise HTTPException(403,"File is hidden")
    if not target.is_file(): raise HTTPException(404,"File not found")
    try: content=target.read_text(encoding="utf-8", errors="replace")
    except OSError: raise HTTPException(404,"File not found")
    try:
        recorder.append(att, SessionEventCreate(type=EventType.file_view, actor=Actor.candidate, payload={"path": rel, "source": "editor"}))
    except BudgetHardStop: pass
    return FileContentResponse(path=rel, content=content, read_only=ro)

@app.put("/attempts/{attempt_id}/files/content", response_model=FileWriteResponse)
def write_file_content(attempt_id: str, body: FileWriteRequest):
    att=store.attempts.get(attempt_id)
    if not att: raise HTTPException(404,"Attempt not found")
    ws=_ws_or_409(att)
    if att.status=="submitted": raise HTTPException(409,"Attempt already submitted - session is frozen")
    target=_safe_ws_path(ws, body.path)
    rel=target.relative_to(ws.resolve()).as_posix()
    ro, hid=_file_flags(att, rel)
    if hid: raise HTTPException(403,"File is hidden")
    if ro: raise HTTPException(403,"File is read-only")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(body.content, encoding="utf-8")
    try:
        recorder.append(att, SessionEventCreate(type=EventType.file_edit, actor=Actor.candidate, payload={"path": rel, "change": "modified", "source": "editor"}))
    except BudgetHardStop: pass
    return FileWriteResponse(path=rel, size=target.stat().st_size)

# ---------------------------------------------------------------------------
# Session lifecycle (B3, restored): heartbeat + expiry. Expiry is lazy —
# checked on heartbeat / session-get / event-post; when the limit has
# passed the attempt flips to "expired", the sandbox is frozen
# best-effort, and a session_expired event is recorded.
# ---------------------------------------------------------------------------

def _parse_iso(v: str):
    if not v: return None
    try: return datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError: return None

def _maybe_expire(att: Attempt) -> bool:
    if att.status != "in_progress": return False
    exp = _parse_iso(att.expires_at)
    if exp is None or datetime.now(timezone.utc) <= exp: return False
    att.status = "expired"
    store.save_attempt(att)
    try: sandbox_manager.freeze(att, reason="time_expired")
    except Exception: pass
    try:
        recorder.append(att, SessionEventCreate(type=EventType.session_expired, actor=Actor.system, payload={"reason": "time_limit"}))
    except Exception: pass
    store.save_attempt(att)
    return True

def _session_status(att: Attempt) -> SessionStatus:
    now = datetime.now(timezone.utc)
    started = _parse_iso(att.started_at)
    exp = _parse_iso(att.expires_at)
    elapsed = int((now - started).total_seconds()) if started else 0
    remaining = int((exp - now).total_seconds()) if exp else 0
    info = sandbox_manager.info(att, sandbox_manager.get(att.id))
    return SessionStatus(
        attempt_id=att.id, status=att.status, started_at=att.started_at,
        expires_at=att.expires_at, elapsed_seconds=max(0, elapsed),
        remaining_seconds=max(0, remaining), time_limit_minutes=att.time_limit_minutes,
        budget=recorder.budget_summary(att), sandbox_status=info.status,
        agent_mode=_agent_mode_of(store.challenges.get(att.challenge_id)))

@app.post("/attempts/{attempt_id}/heartbeat", response_model=SessionStatus)
def heartbeat(attempt_id: str):
    att=store.attempts.get(attempt_id)
    if not att: raise HTTPException(404,"Attempt not found")
    _maybe_expire(att)
    if att.status=="in_progress":
        att.last_heartbeat_at=datetime.now(timezone.utc).isoformat().replace("+00:00","Z")
        store.save_attempt(att)
    return _session_status(att)

@app.get("/attempts/{attempt_id}/session", response_model=SessionStatus)
def get_session(attempt_id: str):
    att=store.attempts.get(attempt_id)
    if not att: raise HTTPException(404,"Attempt not found")
    _maybe_expire(att)
    return _session_status(att)

# ---------------------------------------------------------------------------
# Live sandbox (app/sandbox.py, docs/SANDBOX.md). Start materialises an
# isolated workspace per attempt and starts the recorder watcher; the
# websocket below is a real PTY into it, and every byte is tapped into
# the attempt's event log. Submit freezes the session.
# ---------------------------------------------------------------------------

@app.post("/attempts/{attempt_id}/sandbox/start", response_model=SandboxSessionInfo)
def sandbox_start(attempt_id: str):
    att=store.attempts.get(attempt_id)
    if not att: raise HTTPException(404,"Attempt not found")
    if att.status=="submitted": raise HTTPException(409,"Attempt already submitted - session is frozen")
    ch=store.challenges.get(att.challenge_id)
    if not ch: raise HTTPException(404,"Challenge not found")
    return sandbox_manager.start(att, ch)

@app.post("/attempts/{attempt_id}/sandbox/stop", response_model=SandboxSessionInfo)
def sandbox_stop(attempt_id: str):
    att=store.attempts.get(attempt_id)
    if not att: raise HTTPException(404,"Attempt not found")
    info=sandbox_manager.stop(att)
    return info if info is not None else sandbox_manager.info(att, None)

def _pump_pty(shell, queue: asyncio.Queue, loop: asyncio.AbstractEventLoop, tap: TerminalOutputTap):
    """Reader thread: PTY -> (websocket queue, recorder tap)."""
    try:
        while True:
            if shell.proc.poll() is not None:
                r,_,_=select.select([shell.master_fd],[],[],0)
                if not r: break
            r,_,_=select.select([shell.master_fd],[],[],0.25)
            if r:
                try: data=os.read(shell.master_fd, 65536)
                except OSError: break
                if not data: break
                tap.feed(data)
                loop.call_soon_threadsafe(queue.put_nowait, data)
            else:
                tap.flush_partial()
    except Exception:
        pass
    finally:
        tap.flush_all()

@app.websocket("/ws/sandbox/{attempt_id}")
async def sandbox_ws(websocket: WebSocket, attempt_id: str):
    att=store.attempts.get(attempt_id)
    if not att:
        await websocket.close(code=4404)
        return
    session=sandbox_manager.get(attempt_id)
    if att.status=="submitted" or session is None or session.status!="active":
        # Accept, explain, close — a frozen/unstarted session never gets a shell.
        await websocket.accept()
        await websocket.send_json({"type":"error","message":"Sandbox session is not active (not started, stopped, or frozen by submit)."})
        await websocket.close(code=4409)
        return
    await websocket.accept()
    try:
        shell=sandbox_manager.create_shell(attempt_id)
    except SandboxUnavailable:
        await websocket.send_json({"type":"error","message":"Sandbox session is not active."})
        await websocket.close(code=4409)
        return
    loop=asyncio.get_running_loop()
    queue: asyncio.Queue=asyncio.Queue()
    out_tap=TerminalOutputTap(att)
    in_tap=TerminalInputTap(att)
    reader=threading.Thread(target=_pump_pty, args=(shell, queue, loop, out_tap), daemon=True)
    reader.start()

    async def _send_loop():
        while True:
            data=await queue.get()
            await websocket.send_bytes(data)
    send_task=asyncio.create_task(_send_loop())
    try:
        while True:
            msg=await websocket.receive()
            if msg["type"]=="websocket.disconnect":
                break
            if msg.get("bytes"):
                shell.write(msg["bytes"])
                in_tap.feed(msg["bytes"].decode(errors="ignore"))
            elif msg.get("text") is not None:
                text=msg["text"]
                handled=False
                if text.startswith("{"):
                    try:
                        obj=json.loads(text)
                        if obj.get("type")=="resize":
                            shell.resize(int(obj.get("cols",80)), int(obj.get("rows",24)))
                            handled=True
                    except (ValueError, TypeError):
                        pass
                if not handled:
                    shell.write(text.encode())
                    in_tap.feed(text)
    except WebSocketDisconnect:
        pass
    finally:
        send_task.cancel()
        shell.close()
        out_tap.flush_all()

@app.post("/attempts/{attempt_id}/submit", response_model=Report)
def submit(attempt_id: str, body: SubmitRequest):
    att=store.attempts.get(attempt_id)
    if not att: raise HTTPException(404,"Attempt not found")
    if att.status=="submitted": raise HTTPException(409,"Attempt already submitted")
    # Freeze the live sandbox first (kills PTYs, final git snapshot into
    # the log) so the report timeline includes the frozen end state.
    try: sandbox_manager.freeze(att, reason="candidate_submit")
    except Exception: pass
    ch=store.challenges[att.challenge_id]
    _runs=_score_runs_for(att.id)
    if body.junit_xml is None and body.tap_output is None and body.scorer_output is None and body.manual_functional_score is None and _runs:
        functional=_runs[-1].score  # latest scoring run (B7) is the functional evidence
    else:
        functional=compute_functional_score(junit_xml=body.junit_xml, tap_output=body.tap_output, scorer_output=body.scorer_output, manual=body.manual_functional_score)
    collab, breakdown = compute_collaboration(att.events)
    total=round(ch.rubric_weights.functional*functional + ch.rubric_weights.ai_collaboration*collab,2)
    verdict, signals, concerns, metrics = compute_report_extras(list(att.events), att, total)
    report=Report(attempt_id=att.id, challenge_id=att.challenge_id, candidate_name=att.candidate_name, functional_score=functional, ai_collaboration_score=collab, total_score=total, breakdown=breakdown, timeline=list(att.events), verdict=verdict, signals=signals, concerns=concerns, metrics=metrics)
    att.status="submitted"
    store.save_attempt(att)  # persist even if the session_submitted append is hard-stopped
    try:
        recorder.append(att, SessionEventCreate(type=EventType.session_submitted, actor=Actor.system, payload={"reason":"candidate_submit","tokens_used":att.tokens_used}))
        report.timeline=list(att.events)
    except BudgetHardStop:
        pass  # session already frozen by the budget hard stop; report stands
    store.reports[att.id]=report; return report

@app.get("/attempts/{attempt_id}/report", response_model=Report)
def get_report(attempt_id: str):
    rep=store.reports.get(attempt_id)
    if not rep: raise HTTPException(404,"Report not found - attempt may not be submitted yet")
    return rep
