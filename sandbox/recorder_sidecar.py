#!/usr/bin/env python3
"""Rozark recorder sidecar — SKELETON for the 1-day sandbox proof.

Runs inside the challenge container next to the candidate's workspace.
Watches the workspace directory and reports two event streams to the Rozark
backend (which is the only writer of the ordered event log — this sidecar
submits events, the backend recorder assigns id/seq/ts):

  * file changes  -> `file_edit` events (path, diff ref, line counts)
  * periodic git snapshots -> `git_snapshot` events (commit ref, files
    changed), so replay can restore state at any point

Design notes / honest TODOs for the proof build:
  * Polling + content hashing is used instead of inotify/watchdog so the
    skeleton has zero third-party dependencies. Swap in watchdog for the
    real build if sub-second latency matters.
  * Diff line counts are approximate (hash-based change detection; real
    diffs come from `git diff` against the last snapshot).
  * Delivery is fire-and-forget HTTP POST with one retry; a production
    sidecar needs a local spool so events survive backend restarts.
  * Terminal I/O and agent session-log parsing are NOT here — those are
    tapped by the PTY bridge and the agent adapter respectively
    (docs/SANDBOX.md, recording layer streams a and c).

Usage (inside the container, started by the session launcher):
    ROZARK_BACKEND_URL=http://localhost:8000 \
    python3 recorder_sidecar.py --attempt att_0001 --workspace /workspace
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.request

IGNORED_DIRS = {".git", "__pycache__", "node_modules", ".next", ".venv"}


def fingerprint_file(path: str) -> str:
    """Content hash of one file (sha256, chunked)."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def scan_workspace(root: str) -> dict[str, str]:
    """Map of relative path -> content hash for every file under root."""
    state: dict[str, str] = {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in IGNORED_DIRS]
        for name in filenames:
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, root)
            try:
                state[rel] = fingerprint_file(full)
            except OSError:
                continue  # file vanished mid-scan; next scan settles it
    return state


def diff_snapshots(before: dict[str, str], after: dict[str, str]) -> list[dict]:
    """Pure function: changed/added/removed files between two scans.

    Returns a list of {path, change} where change is added|modified|removed.
    Kept side-effect free so it is unit-testable without a filesystem
    watcher or a backend (see test_recorder_sidecar.py).
    """
    changes = []
    for path in sorted(set(before) | set(after)):
        if path not in before:
            changes.append({"path": path, "change": "added"})
        elif path not in after:
            changes.append({"path": path, "change": "removed"})
        elif before[path] != after[path]:
            changes.append({"path": path, "change": "modified"})
    return changes


def emit_event(backend_url: str, attempt_id: str, event: dict) -> bool:
    """POST one event to the backend recorder. Returns True on HTTP 201."""
    url = f"{backend_url.rstrip('/')}/attempts/{attempt_id}/events"
    data = json.dumps(event).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    for attempt in (1, 2):  # one retry, then drop — see spool TODO above
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                return resp.status == 201
        except Exception:
            if attempt == 2:
                return False
            time.sleep(0.5)
    return False


def git_snapshot(workspace: str, snapshot_id: str, reason: str = "interval") -> dict | None:
    """Commit the workspace state to the sidecar's snapshot branch and
    return the git_snapshot event payload (or None if git fails)."""
    try:
        subprocess.run(["git", "-C", workspace, "add", "-A"], check=True, capture_output=True)
        subprocess.run(["git", "-C", workspace, "commit", "-q", "--allow-empty",
                        "-m", f"rozark snapshot {snapshot_id}"], check=True, capture_output=True)
        ref = subprocess.run(["git", "-C", workspace, "rev-parse", "--short", "HEAD"],
                             check=True, capture_output=True, text=True).stdout.strip()
        changed = subprocess.run(["git", "-C", workspace, "diff", "--name-only", "HEAD~1", "HEAD"],
                                 capture_output=True, text=True).stdout.split()
        return {"snapshot_id": snapshot_id, "commit_ref": ref,
                "files_changed": changed, "reason": reason}
    except Exception:
        return None


def run(attempt_id: str, workspace: str, backend_url: str,
        poll_seconds: float = 1.0, snapshot_seconds: float = 5.0) -> None:
    """Main watch loop (skeleton): poll -> diff -> emit; snapshot on interval."""
    print(f"[sidecar] watching {workspace} for attempt {attempt_id}", file=sys.stderr)
    state = scan_workspace(workspace)
    snapshot_count = 0
    last_snapshot = time.monotonic()
    while True:
        time.sleep(poll_seconds)
        new_state = scan_workspace(workspace)
        changes = diff_snapshots(state, new_state)
        state = new_state
        now = time.monotonic()
        if changes and now - last_snapshot >= snapshot_seconds:
            snapshot_count += 1
            snapshot_id = f"snap_{snapshot_count:04d}"
            payload = git_snapshot(workspace, snapshot_id)
            for c in changes:
                emit_event(backend_url, attempt_id, {
                    "type": "file_edit", "actor": "candidate",
                    "payload": {"path": c["path"], "change": c["change"],
                                "diff_ref": f"{snapshot_id}:{c['path']}",
                                "snapshot_id": snapshot_id},
                })
            if payload:
                emit_event(backend_url, attempt_id, {
                    "type": "git_snapshot", "actor": "system", "payload": payload})
            last_snapshot = now


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Rozark recorder sidecar (skeleton)")
    ap.add_argument("--attempt", required=True, help="Attempt/session id to record for")
    ap.add_argument("--workspace", default=os.environ.get("ROZARK_WORKSPACE", "/workspace"))
    ap.add_argument("--backend", default=os.environ.get("ROZARK_BACKEND_URL", "http://localhost:8000"))
    args = ap.parse_args(argv)
    run(args.attempt, args.workspace, args.backend)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
