# Rozark — Architecture

## Stack
- Backend: Python, FastAPI, Pydantic v2. Storage: in-memory store in the MVP
  (`backend/app/store.py`) behind a small interface; `DATABASE_URL` /
  docker-compose provide PostgreSQL for deployment, SQLite is the local fallback
  story (no Docker required to run tests or the API).
- Frontend: Next.js App Router, TypeScript, Tailwind CSS.
- Infra: Docker / docker-compose.

## Components
```
[Company user] --create challenge--> [Frontend wizard]
                                          |  POST /challenges
[Candidate] --start attempt--> [Backend API] --record--> SessionEvents
                                          |  POST /attempts/{id}/submit
                                   [Scoring engine]
                                     - functional: JUnit/TAP/FS_SCORE parsers
                                     - collaboration: event heuristics
                                          |
                                   [Report] <- GET /attempts/{id}/report
```

## Data flow for an attempt
1. `POST /attempts {challenge_id, candidate_name, candidate_email}` -> attempt in `in_progress`.
2. Client streams events: `POST /attempts/{id}/events {type, payload}`.
   Types: prompt, tool_call, file_view, file_edit, terminal, test_run, agent_response.
3. `POST /attempts/{id}/submit {junit_xml?, tap_output?, scorer_output?}` runs scoring, stores report, marks attempt `submitted`.
4. `GET /attempts/{id}/report` returns dual scores + per-dimension evidence event IDs.

## Security / integrity notes (MVP honesty)
No sandboxing or proctoring is implemented yet. In Rozark's model the session
capture *is* the integrity layer: outside help would appear as unexplained
code with no corresponding prompts/edits/test runs, which the rubric surfaces
via the Independence dimension.

## Future
Sandboxed runner (per-attempt container), websocket event streaming, Postgres
persistence via SQLAlchemy, agent adapters for Claude Code / Codex session logs.
