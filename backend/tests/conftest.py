"""Test isolation for the SQLite-backed store + sandbox workspaces.

Imported by pytest BEFORE any test module imports ``app.*``, so the env
vars below are set before ``app.store`` / ``app.sandbox`` read them:
every test session gets a throwaway DB file and workspace root, and test
data never lands in the developer's real ``backend/rozark.db``.
"""
import os
import tempfile

_TMP = tempfile.mkdtemp(prefix="rozark-test-")
os.environ.setdefault("ROZARK_DB_PATH", os.path.join(_TMP, "test.db"))
os.environ.setdefault("ROZARK_WORKSPACES", os.path.join(_TMP, "workspaces"))
