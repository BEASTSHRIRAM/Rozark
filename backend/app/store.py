"""Durable store — SQLite-backed (increment 3: persistence).

Replaces the pure in-memory store. Design (honest, low-risk):

- One SQLite database file (stdlib ``sqlite3`` — no new dependency),
  path from the ``ROZARK_DB_PATH`` env var, default ``backend/rozark.db``
  (gitignored via ``*.db``).
- Tables: ``kv(kind, id, data)`` with JSON-blob payloads (the Pydantic
  models serialised with ``model_dump_json``) and ``counters(name, value)``
  so id sequences survive restarts and never collide with existing rows.
- The public surface is unchanged from the in-memory version: code keeps
  using ``store.challenges[...]``, ``store.attempts.get(...)``,
  ``store.users[email] = rec``, ``store.next_*_id()`` etc. The dicts are
  write-through: assignment persists immediately; the dicts also act as an
  in-process cache loaded from the DB at startup.
- In-place mutation of a cached object does NOT auto-persist (same
  caveat as any ORM identity map). Mutation sites therefore call
  ``store.save_attempt(att)`` — the recorder does this on every append,
  which covers events, token-budget fields, and status changes made
  before an append; ``submit`` also saves explicitly.

Data now survives a backend restart: challenges, attempts (with their
full event logs), reports, and user accounts are all reloaded at startup.
"""
from __future__ import annotations

import os
import sqlite3
import threading
from pathlib import Path

from .models import Attempt, Challenge, Report, UserRecord

_MODELS = {"challenge": Challenge, "attempt": Attempt, "report": Report, "user": UserRecord}


def default_db_path() -> str:
    env = os.environ.get("ROZARK_DB_PATH")
    if env:
        return env
    return str(Path(__file__).resolve().parent.parent / "rozark.db")


class BlobDict(dict):
    """A dict that writes every assignment/deletion through to SQLite."""

    def __init__(self, store: "Store", kind: str):
        super().__init__()
        self._store = store
        self._kind = kind

    def __setitem__(self, key, value):
        super().__setitem__(key, value)
        self._store._persist(self._kind, key, value)

    def __delitem__(self, key):
        super().__delitem__(key)
        self._store._delete(self._kind, key)


class Store:
    def __init__(self, db_path: str | None = None):
        self.db_path = db_path or default_db_path()
        self._lock = threading.RLock()
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
        with self._lock:
            self._conn.execute(
                "CREATE TABLE IF NOT EXISTS kv ("
                "kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, "
                "PRIMARY KEY (kind, id))"
            )
            self._conn.execute(
                "CREATE TABLE IF NOT EXISTS counters ("
                "name TEXT PRIMARY KEY, value INTEGER NOT NULL)"
            )
            self._conn.commit()
        self.challenges: dict[str, Challenge] = BlobDict(self, "challenge")
        self.attempts: dict[str, Attempt] = BlobDict(self, "attempt")
        self.reports: dict[str, Report] = BlobDict(self, "report")
        # Users keyed by lowercase email (same as the in-memory version).
        self.users: dict[str, UserRecord] = BlobDict(self, "user")
        self._load()

    # -- persistence primitives -------------------------------------------
    def _persist(self, kind: str, key: str, value) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO kv (kind, id, data) VALUES (?, ?, ?)",
                (kind, key, value.model_dump_json()),
            )
            self._conn.commit()

    def _delete(self, kind: str, key: str) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM kv WHERE kind = ? AND id = ?", (kind, key))
            self._conn.commit()

    def _load(self) -> None:
        targets = {
            "challenge": self.challenges,
            "attempt": self.attempts,
            "report": self.reports,
            "user": self.users,
        }
        with self._lock:
            rows = self._conn.execute("SELECT kind, id, data FROM kv").fetchall()
        for kind, key, data in rows:
            model = _MODELS[kind]
            # Bypass BlobDict.__setitem__: the row is already in the DB.
            dict.__setitem__(targets[kind], key, model.model_validate_json(data))

    def save_attempt(self, att: Attempt) -> None:
        """Persist an attempt after in-place mutation (events, status...)."""
        self._persist("attempt", att.id, att)

    # -- id sequences (persisted, so restarts never reuse an id) ----------
    def _next(self, name: str, prefix: str) -> str:
        with self._lock:
            row = self._conn.execute(
                "SELECT value FROM counters WHERE name = ?", (name,)
            ).fetchone()
            value = (row[0] if row else 0) + 1
            self._conn.execute(
                "INSERT OR REPLACE INTO counters (name, value) VALUES (?, ?)",
                (name, value),
            )
            self._conn.commit()
        return f"{prefix}_{value:04d}"

    def next_challenge_id(self): return self._next("challenge", "chal")
    def next_attempt_id(self): return self._next("attempt", "att")
    def next_event_id(self): return self._next("event", "evt")
    def next_user_id(self): return self._next("user", "usr")


store = Store()
