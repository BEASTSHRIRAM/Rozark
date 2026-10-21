"""Sandbox session manager — makes the sandbox REAL (increment 3).

Docs: docs/SANDBOX.md. Two backends behind one interface:

- ``LocalProcessSandbox`` — the path PROVEN on the dev machine: each
  attempt gets an isolated workspace directory (a copy of the challenge
  starter project, git-initialised), shells are real PTYs running bash in
  that directory, and the recorder sidecar's watcher logic runs in-process
  against the directory, streaming file_edit / git_snapshot events into
  the attempt's event log via the backend Recorder (the only writer).
- ``DockerSandbox`` — the production path: same workspace contract, but
  the workspace is volume-mounted into a container started from
  ``sandbox/Dockerfile.challenge`` and shells are ``docker exec -it``
  PTYs. NOT executed on the dev VM (no docker CLI there); if docker is
  requested but unavailable, start falls back to the local backend and
  says so in ``backend_note``.

Sessions are runtime state (not persisted): after a backend restart,
workspaces remain on disk but no session is active until start is called
again. Terminal I/O is tapped into the event log by the WS bridge in
app/main.py using the Tap classes below — the recording is the point.
"""
from __future__ import annotations

import codecs
import fcntl
import importlib.util
import os
import pty
import re
import select
import shutil
import struct
import subprocess
import termios
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .models import Actor, Attempt, Challenge, EventType, SandboxSessionInfo, SessionEventCreate
from .recorder import recorder
from .store import store

BACKEND_DIR = Path(__file__).resolve().parent.parent          # backend/
REPO_ROOT = BACKEND_DIR.parent                                # repo root
SAMPLE_STARTER = REPO_ROOT / "sample-challenges" / "backend-bugfix-api"
_SIDECAR_PATH = REPO_ROOT / "sandbox" / "recorder_sidecar.py"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


def workspaces_root() -> Path:
    return Path(os.environ.get("ROZARK_WORKSPACES", str(BACKEND_DIR / "workspaces")))


def _load_sidecar():
    """Import sandbox/recorder_sidecar.py (not a package) for its pure
    scan/diff/snapshot functions — the same code that runs in-container."""
    spec = importlib.util.spec_from_file_location("rozark_recorder_sidecar", _SIDECAR_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


sidecar = _load_sidecar()


class SandboxUnavailable(Exception):
    """Raised when a sandbox backend cannot launch on this host."""


# --------------------------------------------------------------------------
# PTY shell — one real pseudo-terminal running a command (bash locally,
# `docker exec -it` for the container backend). Bytes in, bytes out.
# --------------------------------------------------------------------------
class PtyShell:
    def __init__(self, command: list[str], cwd: str | None = None, env: dict | None = None):
        self.master_fd, slave_fd = pty.openpty()
        full_env = dict(os.environ)
        full_env["TERM"] = "xterm-256color"
        if env:
            full_env.update(env)
        self.proc = subprocess.Popen(
            command,
            stdin=slave_fd, stdout=slave_fd, stderr=slave_fd,
            cwd=cwd, env=full_env, start_new_session=True, close_fds=True,
        )
        os.close(slave_fd)
        os.set_blocking(self.master_fd, False)
        self._closed = False

    def write(self, data: bytes) -> None:
        if self._closed:
            return
        try:
            os.write(self.master_fd, data)
        except OSError:
            pass

    def resize(self, cols: int, rows: int) -> None:
        if self._closed:
            return
        try:
            fcntl.ioctl(self.master_fd, termios.TIOCSWINSZ,
                        struct.pack("HHHH", max(1, rows), max(1, cols), 0, 0))
        except OSError:
            pass

    @property
    def alive(self) -> bool:
        return not self._closed and self.proc.poll() is None

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            if self.proc.poll() is None:
                os.killpg(self.proc.pid, 15)
                try:
                    self.proc.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    os.killpg(self.proc.pid, 9)
        except (ProcessLookupError, OSError):
            pass
        try:
            os.close(self.master_fd)
        except OSError:
            pass


# --------------------------------------------------------------------------
# Terminal taps — split the PTY byte stream into recorder events.
# Output: one terminal_output event per completed line (plus partial
# flushes). Input: one terminal_cmd event per submitted line.
# --------------------------------------------------------------------------
class TerminalOutputTap:
    def __init__(self, attempt: Attempt):
        self.attempt = attempt
        self._decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
        self._buf = ""
        self._last_feed = time.monotonic()

    def feed(self, data: bytes) -> None:
        self._last_feed = time.monotonic()
        text = self._decoder.decode(data)
        self._buf += text
        while "\n" in self._buf:
            line, self._buf = self._buf.split("\n", 1)
            self._emit(line + "\n")

    def flush_partial(self) -> None:
        if self._buf and time.monotonic() - self._last_feed > 0.4:
            self.flush_all()

    def flush_all(self) -> None:
        if self._buf:
            self._emit(self._buf)
            self._buf = ""

    def _emit(self, text: str) -> None:
        if not text:
            return
        try:
            recorder.append(self.attempt, SessionEventCreate(
                type=EventType.terminal_output, actor=Actor.system,
                payload={"text": text[:2000], "stream": "pty"}))
        except Exception:
            pass  # a full/frozen log must never kill the terminal stream


class TerminalInputTap:
    def __init__(self, attempt: Attempt):
        self.attempt = attempt
        self._buf = ""

    def feed(self, text: str) -> None:
        self._buf += text
        while True:
            idx = min((i for i in (self._buf.find("\r"), self._buf.find("\n")) if i >= 0),
                      default=-1)
            if idx < 0:
                return
            line, self._buf = self._buf[:idx], self._buf[idx + 1:]
            # Drop a paired \n after \r (xterm sends \r; some clients \r\n).
            if self._buf.startswith("\n"):
                self._buf = self._buf[1:]
            command = "".join(ch for ch in line if ch >= " " or ch == "\t").strip()
            if command:
                try:
                    recorder.append(self.attempt, SessionEventCreate(
                        type=EventType.terminal_cmd, actor=Actor.candidate,
                        payload={"command": command[:500], "source": "pty_ws"}))
                except Exception:
                    pass


# --------------------------------------------------------------------------
# Backends
# --------------------------------------------------------------------------
class LocalProcessSandbox:
    name = "local"

    def launch(self, session: "SandboxSession") -> None:
        pass  # the workspace directory IS the sandbox

    def shell(self, session: "SandboxSession") -> PtyShell:
        return PtyShell(["bash", "--norc", "-i"], cwd=str(session.workspace),
                        env={"PS1": "rozark:\\w$ "})

    def teardown(self, session: "SandboxSession") -> None:
        pass


class DockerSandbox:
    """Production path (docs/SANDBOX.md): one container per session from
    the challenge image, workspace volume-mounted at /workspace, shells
    via docker exec. Implemented against the Docker CLI; NOT run on the
    dev VM, which has no docker — start falls back to local there."""

    name = "docker"
    image = os.environ.get("ROZARK_CHALLENGE_IMAGE", "rozark/challenge:latest")

    @staticmethod
    def available() -> bool:
        return shutil.which("docker") is not None

    def launch(self, session: "SandboxSession") -> None:
        if not self.available():
            raise SandboxUnavailable("docker CLI not available on this host")
        name = f"rozark-{session.attempt_id}"
        cmd = ["docker", "run", "-d", "--name", name,
               "--user", "candidate", "--cpus=1", "--memory=1g", "--pids-limit=256",
               "-v", f"{session.workspace}:/workspace", "-w", "/workspace",
               "-e", f"ROZARK_SESSION_ID={session.attempt_id}",
               self.image, "sleep", "infinity"]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0:
            raise SandboxUnavailable(f"docker run failed: {res.stderr.strip()[:300]}")
        session.container_name = name

    def shell(self, session: "SandboxSession") -> PtyShell:
        if not session.container_name:
            raise SandboxUnavailable("docker session has no container")
        return PtyShell(["docker", "exec", "-it", session.container_name, "bash"])

    def teardown(self, session: "SandboxSession") -> None:
        if session.container_name:
            subprocess.run(["docker", "rm", "-f", session.container_name],
                           capture_output=True)
            session.container_name = None


_BACKENDS = {"local": LocalProcessSandbox, "docker": DockerSandbox}


def select_backend(preferred: str | None = None):
    """Pick a backend. Returns (backend_instance, note). Docker requested
    but unavailable -> local backend + an explanatory note (never a lie
    about which backend actually ran)."""
    pref = (preferred or os.environ.get("ROZARK_SANDBOX_BACKEND", "local")).lower()
    if pref == "docker":
        if DockerSandbox.available():
            return DockerSandbox(), ""
        return LocalProcessSandbox(), (
            "docker backend requested but the docker CLI is not available "
            "on this host; using the local-process sandbox")
    return LocalProcessSandbox(), ""


# --------------------------------------------------------------------------
# Session
# --------------------------------------------------------------------------
@dataclass
class SandboxSession:
    attempt_id: str
    workspace: Path
    backend: object
    backend_note: str = ""
    status: str = "active"  # active | stopped | frozen | expired
    started_at: datetime = field(default_factory=_now)
    expires_at: datetime | None = None
    time_limit_minutes: int = 30
    container_name: str | None = None
    shells: list[PtyShell] = field(default_factory=list)
    stop_event: threading.Event = field(default_factory=threading.Event)
    watcher: threading.Thread | None = None
    snap_count: int = 0


class SandboxManager:
    def __init__(self):
        self._sessions: dict[str, SandboxSession] = {}
        self._lock = threading.RLock()

    def get(self, attempt_id: str) -> SandboxSession | None:
        return self._sessions.get(attempt_id)

    # -- lifecycle ---------------------------------------------------------
    def start(self, att: Attempt, challenge: Challenge) -> SandboxSessionInfo:
        with self._lock:
            existing = self._sessions.get(att.id)
            if existing and existing.status == "active":
                return self.info(att, existing)
            backend, note = select_backend()
            workspace = workspaces_root() / att.id
            self._materialise_workspace(att, challenge, workspace)
            time_limit = (challenge.agent_config.time_limit_minutes
                          or challenge.recommended_time_minutes or 30)
            session = SandboxSession(
                attempt_id=att.id, workspace=workspace, backend=backend,
                backend_note=note, time_limit_minutes=time_limit,
                expires_at=_now() + timedelta(minutes=time_limit),
            )
            try:
                backend.launch(session)
            except SandboxUnavailable as e:
                session.backend = LocalProcessSandbox()
                session.backend_note = (note + " " if note else "") + \
                    f"docker launch failed ({e}); using the local-process sandbox"
            self._sessions[att.id] = session
            recorder.append(att, SessionEventCreate(
                type=EventType.session_started, actor=Actor.system,
                payload={"backend": session.backend.name,
                         "workspace_id": att.id,
                         "starter": "sample-challenges/backend-bugfix-api",
                         "time_limit_minutes": time_limit}))
            self._snapshot(att, session, "snap_0000", reason="session_start")
            session.watcher = threading.Thread(
                target=self._watch, args=(att, session), daemon=True,
                name=f"rozark-watch-{att.id}")
            session.watcher.start()
            return self.info(att, session)

    def _materialise_workspace(self, att: Attempt, challenge: Challenge,
                               workspace: Path) -> None:
        # Only the seeded sample challenge has a starter tree in-repo;
        # other sources fall back to it for now (labelled in the event
        # payload + SANDBOX.md status). Hidden test files are never copied.
        if workspace.exists():
            shutil.rmtree(workspace)
        workspace.mkdir(parents=True)

        def _ignore(_dir, names):
            return [n for n in names if n in ("__pycache__", ".git")
                    or n == "test_hidden.py" or n.endswith(".pyc")]

        shutil.copytree(SAMPLE_STARTER, workspace, dirs_exist_ok=True, ignore=_ignore)
        subprocess.run(["git", "init", "-q"], cwd=workspace,
                       check=True, capture_output=True)

    def _snapshot(self, att: Attempt, session: SandboxSession,
                  snapshot_id: str, reason: str) -> None:
        payload = sidecar.git_snapshot(str(session.workspace), snapshot_id, reason=reason)
        if payload:
            try:
                recorder.append(att, SessionEventCreate(
                    type=EventType.git_snapshot, actor=Actor.system, payload=payload))
            except Exception:
                pass

    def _watch(self, att: Attempt, session: SandboxSession) -> None:
        """Recorder sidecar logic, in-process: poll the workspace, emit
        file_edit events for changes, git_snapshot on the interval."""
        state = sidecar.scan_workspace(str(session.workspace))
        pending: dict[str, dict] = {}
        last_snapshot = time.monotonic()
        while not session.stop_event.is_set():
            time.sleep(0.5)
            if att.status == "submitted":
                break
            if session.expires_at and _now() > session.expires_at \
                    and session.status == "active":
                session.status = "expired"
                for sh in list(session.shells):
                    sh.close()
                break
            try:
                new_state = sidecar.scan_workspace(str(session.workspace))
            except Exception:
                continue
            for c in sidecar.diff_snapshots(state, new_state):
                pending[c["path"]] = c
            state = new_state
            if pending and time.monotonic() - last_snapshot >= 3.0:
                session.snap_count += 1
                snapshot_id = f"snap_{session.snap_count:04d}"
                for c in pending.values():
                    try:
                        recorder.append(att, SessionEventCreate(
                            type=EventType.file_edit, actor=Actor.candidate,
                            payload={"path": c["path"], "change": c["change"],
                                     "diff_ref": f"{snapshot_id}:{c['path']}",
                                     "snapshot_id": snapshot_id,
                                     "source": "sandbox_watcher"}))
                    except Exception:
                        pass
                pending.clear()
                self._snapshot(att, session, snapshot_id, reason="interval")
                last_snapshot = time.monotonic()

    def create_shell(self, attempt_id: str) -> PtyShell:
        session = self._sessions.get(attempt_id)
        if not session or session.status != "active":
            raise SandboxUnavailable("sandbox session is not active")
        shell = session.backend.shell(session)
        session.shells.append(shell)
        return shell

    def stop(self, att: Attempt, reason: str = "session_stop") -> SandboxSessionInfo | None:
        session = self._sessions.get(att.id)
        if not session:
            return None
        self._teardown(att, session, reason,
                       status="frozen" if reason == "candidate_submit" else "stopped")
        return self.info(att, session)

    def freeze(self, att: Attempt, reason: str = "candidate_submit") -> SandboxSessionInfo | None:
        """Submit path: kill shells, stop the watcher, final snapshot."""
        session = self._sessions.get(att.id)
        if not session or session.status != "active":
            return self.info(att, session) if session else None
        self._teardown(att, session, reason, status="frozen")
        return self.info(att, session)

    def _teardown(self, att: Attempt, session: SandboxSession,
                  reason: str, status: str) -> None:
        session.stop_event.set()
        for sh in list(session.shells):
            sh.close()
        session.shells.clear()
        watcher = session.watcher
        if watcher and watcher.is_alive() and watcher is not threading.current_thread():
            watcher.join(timeout=3)
        try:
            session.backend.teardown(session)
        except Exception:
            pass
        if session.status == "active":
            session.status = status
        session.snap_count += 1
        self._snapshot(att, session, f"snap_{session.snap_count:04d}", reason=reason)

    # -- reporting -----------------------------------------------------------
    def info(self, att: Attempt, session: SandboxSession | None) -> SandboxSessionInfo:
        if session is None:
            return SandboxSessionInfo(
                attempt_id=att.id, session_id=att.session_id or att.id,
                workspace_id=att.id, backend="", status="not_started",
                ws_url=f"/ws/sandbox/{att.id}")
        return SandboxSessionInfo(
            attempt_id=att.id, session_id=att.session_id or att.id,
            workspace_id=att.id, workspace_path=str(session.workspace),
            backend=session.backend.name, backend_note=session.backend_note,
            status=session.status, ws_url=f"/ws/sandbox/{att.id}",
            started_at=_iso(session.started_at),
            expires_at=_iso(session.expires_at) if session.expires_at else "",
            time_limit_minutes=session.time_limit_minutes)


sandbox_manager = SandboxManager()
