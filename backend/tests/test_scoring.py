from app.scoring import parse_junit_xml, parse_tap, parse_fs_score, compute_functional_score, compute_collaboration
from app.models import SessionEvent, EventType

JUNIT = '<testsuite name="t" tests="5" failures="1" errors="0" skipped="0"><testcase name="a"/></testsuite>'
TAP = "TAP version 13\n1..4\nok 1 - a\nok 2 - b\nnot ok 3 - c\nok 4 - d\n"

def test_junit():
    assert parse_junit_xml(JUNIT) == 80.0

def test_junit_all_pass():
    assert parse_junit_xml('<testsuite tests="3" failures="0" errors="0" skipped="0"/>') == 100.0

def test_tap():
    assert parse_tap(TAP) == 75.0

def test_fs_score():
    assert parse_fs_score("done\nFS_SCORE: 60%\n") == 60.0

def test_fs_score_missing():
    assert parse_fs_score("nothing") is None

def test_functional_priority_fs_over_junit():
    assert compute_functional_score(junit_xml=JUNIT, scorer_output="FS_SCORE: 60%") == 60.0

def ev(i, t, **payload):
    return SessionEvent(id=f"evt_{i}", attempt_id="att_1", sequence=i, type=t, payload=payload)

def test_collaboration_empty():
    score, dims = compute_collaboration([])
    assert score == 0.0 and all(d.score == 0 for d in dims)

def test_collaboration_evidence():
    events = [
        ev(1, EventType.prompt, text="Fix pagination bug in app/main.py, check offset error"),
        ev(2, EventType.file_view, path="app/main.py"),
        ev(3, EventType.file_view, path="tests/test_api.py"),
        ev(4, EventType.file_edit, path="app/main.py"),
        ev(5, EventType.test_run, command="pytest -q"),
        ev(6, EventType.file_edit, path="app/main.py"),
        ev(7, EventType.test_run, command="pytest -q"),
    ]
    score, dims = compute_collaboration(events)
    assert score > 50
    by = {d.dimension: d for d in dims}
    assert by["prompting"].evidence_event_ids == ["evt_1"]
    assert len(by["exploration"].evidence_event_ids) == 2
    assert by["debugging"].score > 0
