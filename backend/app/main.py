import asyncio
import json
import os
import select
import threading
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, HTTPException, Header, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from .models import *
from .store import store
from .seed import seed
from .scoring import compute_functional_score, compute_collaboration
from .recorder import recorder, BudgetHardStop
from .auth import hash_password, verify_password, create_token, current_user_id
from .sandbox import sandbox_manager, SandboxUnavailable, TerminalInputTap, TerminalOutputTap

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

@app.get("/attempts/{attempt_id}/events", response_model=list[SessionEvent])
def list_events(attempt_id: str):
    att=store.attempts.get(attempt_id)
    if not att: raise HTTPException(404,"Attempt not found")
    return recorder.ordered_events(att)

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
