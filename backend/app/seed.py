import os

from .models import *
from .store import store
from .auth import hash_password
from .recorder import recorder, BudgetHardStop
from .scoring import compute_collaboration, compute_functional_score

# Demo account for local evaluation — seeded into the durable store.
# Login: demo@rozark.dev / demo1234 (see README "Demo account").
DEMO_EMAIL = "demo@rozark.dev"
DEMO_PASSWORD = "demo1234"

def seed_demo_user():
    if DEMO_EMAIL in store.users: return
    rec = UserRecord(
        id=store.next_user_id(),
        company_name="Demo Startup",
        name="Demo Recruiter",
        email=DEMO_EMAIL,
        password_hash=hash_password(DEMO_PASSWORD),
    )
    store.users[DEMO_EMAIL] = rec

def seed():
    seed_demo_user()
    if not store.challenges:
        _seed_sample_challenge()
    seed_demo_attempt()

def _seed_sample_challenge():
    c=ChallengeCreate(
        title="Fix the orders API pagination bug",
        type=ChallengeType.backend, difficulty=Difficulty.medium,
        tags=["python","fastapi","debugging"],
        problem_description="The /items endpoint returns duplicate items across pages. Find and fix the bug, keep tests passing.",
        software_instructions="Python 3.12",
        interviewer_guidelines="Reference fix is in sample-challenges/backend-bugfix-api (offset calculation).",
        environment=Environment(stack="python-fastapi"),
        project_setup=ProjectSetup(source=ProjectSource.sample),
        ide_setup=IDESetup(install_command="pip install -r requirements.txt", run_command="python -m app.main", test_command="pytest -q", default_open_files=["README.md","app/main.py"], read_only_files=["README.md"], hidden_files=["tests/test_hidden.py"]),
        scoring=ScoringSettings(mode=ScoringMode.automated, format=ScoringFormat.junit, scoring_command="pytest --junitxml=results.xml", scoring_output_files=["results.xml"]),
    ).apply_defaults()
    ch=Challenge(id=store.next_challenge_id(), **c.model_dump())
    store.challenges[ch.id]=ch

# ---------------------------------------------------------------------------
# Demo attempt (opt-in): ROZARK_SEED_DEMO=1 seeds ONE submitted attempt with
# a realistic recorded session and a REAL report — the events below go
# through the Recorder (the only event-log writer) and the report is built
# with the same scoring functions and weighted total as POST
# /attempts/{id}/submit, so GET /attempts/{id}/report works on first boot.
# Idempotent: any existing attempt (seeded or real) makes this a no-op.
# Off by default: without the env var nothing here runs.
# ---------------------------------------------------------------------------
DEMO_CANDIDATE_NAME = "Demo Candidate"
DEMO_CANDIDATE_EMAIL = "demo.candidate@rozark.dev"

# Sample scoring input for the demo submit: 4 of 5 tests passing.
DEMO_JUNIT_XML = (
    '<testsuite name="demo-items-api" tests="5" failures="1" errors="0" skipped="0">'
    '<testcase classname="tests.test_items" name="test_first_page"/>'
    '<testcase classname="tests.test_items" name="test_second_page_no_duplicates"/>'
    '<testcase classname="tests.test_items" name="test_page_size_respected"/>'
    '<testcase classname="tests.test_items" name="test_empty_page"/>'
    '<testcase classname="tests.test_items" name="test_last_page_partial">'
    '<failure message="expected 2 items on last page, got 3"/></testcase>'
    "</testsuite>"
)


def _demo_event_bodies():
    """A small, realistic session: plan -> explore -> fix -> test -> iterate."""
    return [
        SessionEventCreate(type=EventType.session_started, actor=Actor.system,
                           payload={"backend": "local", "seeded": True, "demo": True}),
        SessionEventCreate(type=EventType.brief_viewed, actor=Actor.candidate,
                           payload={"path": "README.md"}),
        SessionEventCreate(type=EventType.prompt, actor=Actor.candidate, payload={
            "text": "Plan first: the /items endpoint returns duplicate rows across "
                    "pages — likely an offset bug in app/main.py. Inspect the "
                    "pagination code, fix it, then run the tests.",
            "phase": PromptPhase.planning.value, "agent": "claude_code"}),
        SessionEventCreate(type=EventType.token_usage, actor=Actor.agent, payload={
            "tokens_in": 1200, "tokens_out": 350,
            "phase": PromptPhase.planning.value, "model": "claude-sonnet-4-5"}),
        SessionEventCreate(type=EventType.file_view, actor=Actor.candidate,
                           payload={"path": "app/main.py"}),
        SessionEventCreate(type=EventType.file_view, actor=Actor.candidate,
                           payload={"path": "tests/test_items.py"}),
        SessionEventCreate(type=EventType.terminal_cmd, actor=Actor.candidate,
                           payload={"command": "grep -rn offset app/", "source": "seed_demo"}),
        SessionEventCreate(type=EventType.file_edit, actor=Actor.candidate, payload={
            "path": "app/main.py", "change": "modified", "source": "seed_demo"}),
        SessionEventCreate(type=EventType.token_usage, actor=Actor.agent, payload={
            "tokens_in": 1500, "tokens_out": 600,
            "phase": PromptPhase.building.value, "model": "claude-sonnet-4-5"}),
        SessionEventCreate(type=EventType.test_run, actor=Actor.candidate, payload={
            "command": "pytest -q", "tests_total": 5, "passed": 3, "failed": 2,
            "source": "seed_demo"}),
        SessionEventCreate(type=EventType.prompt, actor=Actor.candidate, payload={
            "text": "Two tests still fail: the last page returns 3 items instead of 2. "
                    "The offset fix in app/main.py helped page 2 but the final-page "
                    "slice is still off — check the end index calculation.",
            "phase": PromptPhase.debugging.value, "agent": "claude_code"}),
        SessionEventCreate(type=EventType.token_usage, actor=Actor.agent, payload={
            "tokens_in": 900, "tokens_out": 500,
            "phase": PromptPhase.debugging.value, "model": "claude-sonnet-4-5"}),
        SessionEventCreate(type=EventType.file_edit, actor=Actor.candidate, payload={
            "path": "app/main.py", "change": "modified", "source": "seed_demo"}),
        SessionEventCreate(type=EventType.test_run, actor=Actor.candidate, payload={
            "command": "pytest -q", "tests_total": 5, "passed": 4, "failed": 1,
            "source": "seed_demo"}),
    ]


def seed_demo_attempt():
    """Seed the demo attempt + report when ROZARK_SEED_DEMO=1.

    Returns the attempt, or None when disabled / already seeded / no
    challenge exists yet. Mirrors the submit path in app/main.py (minus
    the live-sandbox freeze: no session was ever started for this attempt).
    Report is constructed with only the Report fields that exist in this
    tree, so enriched Report models on other branches stay compatible.
    """
    if os.environ.get("ROZARK_SEED_DEMO") != "1":
        return None
    if store.attempts:
        return None  # idempotent: never seed twice, never touch real data
    if not store.challenges:
        return None
    ch = next(iter(store.challenges.values()))
    att = Attempt(
        id=store.next_attempt_id(),
        challenge_id=ch.id,
        candidate_name=DEMO_CANDIDATE_NAME,
        candidate_email=DEMO_CANDIDATE_EMAIL,
    )
    att.session_id = att.id
    att.token_budget = ch.agent_config.token_budget
    store.attempts[att.id] = att
    for body in _demo_event_bodies():
        recorder.append(att, body)
    # --- submit (same logic as POST /attempts/{id}/submit) ---
    functional = compute_functional_score(junit_xml=DEMO_JUNIT_XML)
    collab, breakdown = compute_collaboration(att.events)
    total = round(
        ch.rubric_weights.functional * functional
        + ch.rubric_weights.ai_collaboration * collab, 2)
    report = Report(
        attempt_id=att.id, challenge_id=att.challenge_id,
        candidate_name=att.candidate_name, functional_score=functional,
        ai_collaboration_score=collab, total_score=total,
        breakdown=breakdown, timeline=list(att.events))
    att.status = "submitted"
    store.save_attempt(att)
    try:
        recorder.append(att, SessionEventCreate(
            type=EventType.session_submitted, actor=Actor.system,
            payload={"reason": "candidate_submit", "tokens_used": att.tokens_used,
                     "seeded": True}))
        report.timeline = list(att.events)
    except BudgetHardStop:
        pass  # report stands even if the budget hard stop fired first
    store.reports[att.id] = report
    return att
