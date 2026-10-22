"""ROZARK_SEED_DEMO demo-attempt seeding (backend/app/seed.py).

The suite shares one global store, so these tests run the seed against a
FRESH Store on a temp DB, monkeypatched into the modules that resolve
``store`` at call time (app.seed, app.recorder, app.main).
"""
import pytest
from fastapi.testclient import TestClient

import app.main as main_mod
import app.recorder as recorder_mod
import app.seed as seed_mod
from app.store import Store


@pytest.fixture()
def fresh_store(tmp_path, monkeypatch):
    fresh = Store(str(tmp_path / "seed-test.db"))
    monkeypatch.setattr(seed_mod, "store", fresh)
    monkeypatch.setattr(recorder_mod, "store", fresh)
    monkeypatch.setattr(main_mod, "store", fresh)
    seed_mod._seed_sample_challenge()
    assert len(fresh.challenges) == 1
    return fresh


def test_seed_demo_off_by_default(fresh_store, monkeypatch):
    monkeypatch.delenv("ROZARK_SEED_DEMO", raising=False)
    assert seed_mod.seed_demo_attempt() is None
    assert len(fresh_store.attempts) == 0
    assert len(fresh_store.reports) == 0


def test_seed_demo_creates_attempt_with_real_report(fresh_store, monkeypatch):
    monkeypatch.setenv("ROZARK_SEED_DEMO", "1")
    att = seed_mod.seed_demo_attempt()
    assert att is not None
    assert att.candidate_name == "Demo Candidate"
    assert att.status == "submitted"
    assert len(fresh_store.attempts) == 1

    # The recorded session is real: ordered events of the expected kinds,
    # token usage tracked and within budget.
    types = {e.type.value for e in att.events}
    assert {"session_started", "prompt", "file_view", "file_edit",
            "terminal_cmd", "token_usage", "test_run",
            "session_submitted"} <= types
    seqs = [e.seq for e in att.events]
    assert seqs == sorted(seqs) and len(set(seqs)) == len(seqs)
    assert 0 < att.tokens_used < att.token_budget
    assert set(att.tokens_by_phase) == {"planning", "building", "debugging"}

    # The report is the real scoring output, not a canned object.
    rep = fresh_store.reports.get(att.id)
    assert rep is not None
    assert rep.functional_score == 80.0  # DEMO_JUNIT_XML: 4 of 5 passing
    assert 0 < rep.ai_collaboration_score <= 100
    assert rep.total_score == round(
        0.4 * rep.functional_score + 0.6 * rep.ai_collaboration_score, 2)
    assert rep.breakdown and rep.timeline

    # And it is served by the real endpoint.
    client = TestClient(main_mod.app)
    r = client.get(f"/attempts/{att.id}/report")
    assert r.status_code == 200
    assert r.json()["total_score"] == rep.total_score
    assert r.json()["candidate_name"] == "Demo Candidate"


def test_seed_demo_idempotent(fresh_store, monkeypatch):
    monkeypatch.setenv("ROZARK_SEED_DEMO", "1")
    first = seed_mod.seed_demo_attempt()
    assert first is not None
    n_events = len(first.events)
    # Direct re-seed and the full startup seed path both no-op.
    assert seed_mod.seed_demo_attempt() is None
    seed_mod.seed()
    assert len(fresh_store.attempts) == 1
    assert len(fresh_store.reports) == 1
    assert len(first.events) == n_events
