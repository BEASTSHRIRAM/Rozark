# Contributing to Rozark

Rozark is open-source and welcomes contributions.

## Principles
- Evidence over vibes: every score must link to session events.
- Transparent scoring: heuristics live in `backend/app/scoring.py` and `docs/SCORING_RUBRIC.md`. If you change one, change both.
- No black-box LLM judging in the MVP path. LLM-assisted review, if added, is advisory and labelled.

## Dev setup
Backend: `cd backend && pip install -r requirements.txt && pytest -q && uvicorn app.main:app --reload`
Frontend: `cd frontend && npm install && npm run dev`

## Workflow (project convention)
- Do not push directly to `main`. Work on a branch and raise a PR.
- Keep PRs small, include test output for scoring changes.

## Adding a sample challenge
Follow `docs/CHALLENGE_SCHEMA.md` and the example in `sample-challenges/backend-bugfix-api/`.
