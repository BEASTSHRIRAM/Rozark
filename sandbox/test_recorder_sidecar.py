"""Small tests for the recorder sidecar's pure logic (no watcher/backend)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from recorder_sidecar import diff_snapshots, fingerprint_file, scan_workspace


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
