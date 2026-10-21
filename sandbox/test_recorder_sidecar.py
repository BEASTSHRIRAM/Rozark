"""Small tests for the recorder sidecar's pure logic (no watcher/backend)."""
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from recorder_sidecar import diff_snapshots, fingerprint_file, git_snapshot, scan_workspace


def test_diff_detects_added_modified_removed():
    before = {"a.py": "h1", "b.py": "h2", "c.py": "h3"}
    after = {"a.py": "h1", "b.py": "CHANGED", "d.py": "h4"}
    changes = {c["path"]: c["change"] for c in diff_snapshots(before, after)}
    assert changes == {"b.py": "modified", "c.py": "removed", "d.py": "added"}


def test_diff_empty_when_identical():
    state = {"a.py": "h1"}
    assert diff_snapshots(state, dict(state)) == []


def test_scan_and_fingerprint_roundtrip(tmp_path):
    p = tmp_path / "main.py"
    p.write_text("print('hi')\n")
    state = scan_workspace(str(tmp_path))
    assert state["main.py"] == fingerprint_file(str(p))
    p.write_text("print('changed')\n")
    assert scan_workspace(str(tmp_path))["main.py"] != state["main.py"]


def test_git_snapshot_without_configured_identity_and_first_commit_files(tmp_path, monkeypatch):
    # Regression: the challenge container's user has no git identity, so
    # `git commit` used to fail and every snapshot silently returned None;
    # and the root commit has no HEAD~1, so files_changed was always [].
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))  # empty HOME => no global git identity
    ws = tmp_path / "ws"
    ws.mkdir()
    subprocess.run(["git", "init", "-q", str(ws)], check=True)
    (ws / "a.py").write_text("print(1)\n")
    snap = git_snapshot(str(ws), "snap_0001")
    assert snap is not None and snap["commit_ref"]
    assert snap["files_changed"] == ["a.py"]
    (ws / "a.py").write_text("print(2)\n")
    snap2 = git_snapshot(str(ws), "snap_0002")
    assert snap2 is not None and snap2["files_changed"] == ["a.py"]
