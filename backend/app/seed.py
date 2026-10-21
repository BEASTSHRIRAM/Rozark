from .models import *
from .store import store
from .auth import hash_password

# Demo account for local evaluation — created in-memory at startup.
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
    if store.challenges: return
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
