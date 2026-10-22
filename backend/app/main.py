import asyncio
import json
import os
import select
import threading
import httpx
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, HTTPException, Header, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from .models import *
from .store import store
from .seed import seed
from .scoring import compute_functional_score, compute_collaboration
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
# Agent budget proxy (B6): the ONLY path from a candidate session to the
# model API. The key never reaches the browser/sandbox; every call is
# recorded (prompt -> token_usage -> agent_response) and the recorder's
# hard stop refuses agent activity once the token cap is hit.
# ---------------------------------------------------------------------------

def _ai_api_key() -> str:
    return os.environ.get("ROZARK_AI_API_KEY") or os.environ.get("ANTHROPIC_API_KEY") or ""

def _ai_model(challenge=None) -> str:
    if challenge is not None and challenge.agent_config.model:
        return challenge.agent_config.model
    return os.environ.get("ROZARK_AI_MODEL") or "claude-sonnet-4-5"

@app.get("/agent/status", response_model=AgentStatus)
def agent_status():
    return AgentStatus(configured=bool(_ai_api_key()), provider="anthropic", model=_ai_model())

@app.post("/attempts/{attempt_id}/agent/chat", response_model=AgentChatResponse)
def agent_chat(attempt_id: str, body: AgentChatRequest):
    att=store.attempts.get(attempt_id)
    if not att: raise HTTPException(404,"Attempt not found")
    if att.status=="submitted": raise HTTPException(409,"Attempt already submitted - session is frozen")
    if att.budget_hard_stop:
        raise HTTPException(403, f"Token budget hard stop is active for attempt {att.id} ({att.tokens_used}/{att.token_budget} tokens used).")
    key=_ai_api_key()
    if not key:
        return JSONResponse(status_code=503, content={"detail": "Agent proxy is not configured: set ROZARK_AI_API_KEY (or ANTHROPIC_API_KEY) on the backend.", "code": "agent_not_configured"})
    ch=store.challenges.get(att.challenge_id)
    model=_ai_model(ch)
    try:
        recorder.append(att, SessionEventCreate(type=EventType.prompt, actor=Actor.candidate, payload={"text": body.prompt, "phase": body.phase, "mode": body.mode, "via": "agent_proxy"}))
    except BudgetHardStop as e:
        raise HTTPException(403, str(e))
    system_prompt=(f"You are an AI coding agent helping a candidate inside a recorded Rozark assessment sandbox. "
                   f"Challenge: {ch.title if ch else att.challenge_id}. "
                   "Your prompts, tool use and responses are recorded and scored as collaboration evidence. Be concise and concrete.")
    try:
        http=httpx.Client(timeout=60)
        resp=http.post("https://api.anthropic.com/v1/messages",
                       headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                       json={"model": model, "max_tokens": 1024, "system": system_prompt,
                             "messages": [{"role": "user", "content": body.prompt}]})
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Agent provider request failed: {e}")
    if resp.status_code != 200:
        raise HTTPException(502, f"Agent provider returned HTTP {resp.status_code}")
    try: data=resp.json()
    except ValueError: raise HTTPException(502, "Agent provider returned invalid JSON")
    text="".join(str(b.get("text","")) for b in data.get("content", []) if isinstance(b, dict) and b.get("type")=="text")
    usage=data.get("usage", {}) or {}
    try: tokens_in=int(usage.get("input_tokens", 0) or 0)
    except (TypeError, ValueError): tokens_in=0
    try: tokens_out=int(usage.get("output_tokens", 0) or 0)
    except (TypeError, ValueError): tokens_out=0
    recorder.append(att, SessionEventCreate(type=EventType.token_usage, actor=Actor.system, payload={"tokens_in": tokens_in, "tokens_out": tokens_out, "phase": body.phase, "via": "agent_proxy"}))
    recorder.append(att, SessionEventCreate(type=EventType.agent_response, actor=Actor.agent, payload={"text": text, "phase": body.phase, "via": "agent_proxy"}))
    return AgentChatResponse(response_text=text, tokens_in=tokens_in, tokens_out=tokens_out, budget=recorder.budget_summary(att))

# ---------------------------------------------------------------------------
# Workspace files (B5): the editor's view of the sandbox workspace. Reads
# and writes go through the recorder so file_view / file_edit land in the
# same ordered event log as everything else. Hidden files are never
# served; read-only files are never written.
# ---------------------------------------------------------------------------

def _ws_or_409(att: Attempt):
    ws = workspace_path_for(att.id)
    if not ws.is_dir():
        raise HTTPException(409, "sandbox not started")
    return ws

def _safe_ws_path(ws, raw: str):
    from pathlib import Path as _P
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
# Session lifecycle (B3): heartbeat + expiry. Expiry is lazy — checked on
# heartbeat / session-get / event-post; when the limit has passed the
# attempt flips to "expired", the sandbox is frozen best-effort, and a
# session_expired event is recorded through the recorder.
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
        budget=recorder.budget_summary(att), sandbox_status=info.status)

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
    functional=compute_functional_score(junit_xml=body.junit_xml, tap_output=body.tap_output, scorer_output=body.scorer_output, manual=body.manual_functional_score)
    collab, breakdown = compute_collaboration(att.events)
    total=round(ch.rubric_weights.functional*functional + ch.rubric_weights.ai_collaboration*collab,2)
    report=Report(attempt_id=att.id, challenge_id=att.challenge_id, candidate_name=att.candidate_name, functional_score=functional, ai_collaboration_score=collab, total_score=total, breakdown=breakdown, timeline=list(att.events))
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
