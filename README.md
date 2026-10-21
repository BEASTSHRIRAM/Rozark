# Rozark

**AI-native technical assessment platform — evaluate how candidates actually use AI coding agents.**

> Open-source, self-hostable (Frappe-inspired). Built for startups hiring interns and fresh graduates in India, where AI-assisted development is now an essential skill.

Traditional coding tests score only the final answer. Rozark scores the *process* as well:
prompting strategy, repository exploration, tool usage, debugging iterations, testing
practices, and final code quality — producing an evidence-backed candidate report.

## Vision

Companies receive a report showing not just *what* a candidate built, but *how
effectively they collaborated with AI* (Claude Code, OpenAI Codex, Cursor, etc.)
to build it. Every score in the report links to concrete session events.

## HackerRank model -> Rozark mapping

Rozark borrows HackerRank's proven project-question flow, then adds AI-native layers:

| HackerRank project question | Rozark |
|---|---|
| Environment selection | Same + runtime image / stack |
| Project Setup: Upload Zip (<=5MB) / Clone from GitHub / Sample | Same three sources |
| IDE Setup: Install / Run / Test commands | Same |
| Default open files, Read-only files, Hidden files | Same |
| Scoring: automated (JUnit/xUnit/TAP proportional), manual, custom script `FS_SCORE: XY%` | Same — this becomes the *Functional* score |
| Question Details: Easy 50/15m, Medium 75/30m, Hard 100/45-60m, tags, interviewer guidelines, Try question | Same |
| — (no equivalent) | **AI Agent Config**: allowed agents, model, token budget, internet on/off |
| — (scores only final output) | **Dual scoring + Session timeline replay + Evidence-backed report** |

## Dual scoring

```
Total = 0.40 * Functional + 0.60 * AI Collaboration
```

- **Functional (40%)** — HackerRank-style: proportion of unit tests passed
  (JUnit XML / TAP parsed), or a custom scorer printing `FS_SCORE: 73%`.
- **AI Collaboration (60%)** — transparent heuristics over recorded session events:
  Prompting, Exploration, Verification/Testing, Debugging, Independence/Code-quality
  proxies. Each dimension lists the event IDs that produced it. No black-box score.
  See `docs/SCORING_RUBRIC.md`.

## Differentiation — references & competitors, honestly

Rozark is not the only team working on AI-native assessment, and it doesn't
pretend otherwise:

- **HackerRank** (reference model) — the project-question creation flow this
  repo borrows (see the mapping above). HackerRank scores the final output;
  Rozark also scores the recorded process.
- **HirePrise by HackCulture** (direct competitor) — real codebase + ticket,
  an AI assistant panel beside the editor, hidden tests, and a follow-up
  interview on the candidate's own code. Its assessment UI (brief left, code
  middle, AI right) and report cards (Fit %, hire signals/concerns linked to
  evidence, phase-tagged prompts, tokens vs budget) are the inspiration for
  Rozark's attempt and report views — which are labelled as such in the UI.

Where Rozark is different:

1. **Open-source & self-hostable.** Companies run Rozark themselves
   (Frappe-inspired), inspect the scoring logic, and keep candidate session
   data on their own infrastructure. HirePrise and HackerRank are hosted,
   closed SaaS.
2. **Real terminal agents, not a chat panel.** Candidates drive Claude Code /
   Codex inside a per-session sandbox container — the same tools they'd use
   on the job — instead of a built-in chat assistant beside the editor.
3. **Full session replay from one event log.** Every session is recorded as
   a single ordered event log (terminal I/O, file changes + git snapshots,
   agent prompts/tool calls, token usage) defined in
   `docs/EVENT_LOG_SCHEMA.md`. Reviewers don't just see a score — they can
   scrub the whole session, and every report score links to the exact events
   behind it. See `docs/SANDBOX.md` for the sandbox design.

## Repo layout

```
backend/            FastAPI app, scoring engine, event recorder, pytest tests
frontend/           Next.js (App Router) + TypeScript + Tailwind
docs/               PRODUCT, ARCHITECTURE, CHALLENGE_SCHEMA, SCORING_RUBRIC,
                    EVENT_LOG_SCHEMA, SANDBOX
sandbox/            Challenge image (Dockerfile.challenge) + recorder sidecar
sample-challenges/  Runnable example challenge(s)
docker-compose.yml  PostgreSQL + backend + frontend
```

## How to run

### Backend (no Docker needed — durable SQLite store)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
# http://localhost:8000/docs   |   GET /health
pytest -q
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# http://localhost:3000
```

The landing page is `/`, the app lives behind login at `/dashboard`.

### Demo account

The backend seeds a demo account at startup (into the durable store):

- **Email:** `demo@rozark.dev`
- **Password:** `demo1234`

Or create your own account on the `/signup` page (company name, your name,
email, password). Auth is real: passwords are pbkdf2-hashed, sessions are
signed JWTs (`ROZARK_JWT_SECRET` env var; a marked dev default is used if
unset). All data — users, challenges, attempts, event logs — persists in
SQLite (`backend/rozark.db` by default; override with `ROZARK_DB_PATH`)
and survives backend restarts.

### Deploying the frontend (Vercel)

The Next.js app lives in `frontend/` — the repo root is **not** a Next.js
project. If you deploy this repo to Vercel:

1. In the Vercel project settings, set **Root Directory = `frontend`**.
   (Deploying from the repo root serves bare, unstyled HTML — the app and
   its Tailwind CSS never get built.)
2. `frontend/vercel.json` already declares `"framework": "nextjs"`.
3. Set `NEXT_PUBLIC_API_URL` to your deployed backend URL (defaults to
   `http://localhost:8000` for local dev).

### Full stack via Docker

```bash
docker compose up --build
```

## Status

MVP — honestly labelled. In and working:

- **Landing + auth**: a HirePrise-grade marketing landing page (`/`,
  GSAP-animated quietly — reveals + count-ups, reduced-motion respected;
  palette discipline: near-black/white/grey + one indigo accent, no
  gradients), real signup/login auth (JWT + pbkdf2), and an app shell
  (`/dashboard`, challenges, wizard, attempt, report). The
  create-challenge wizard's Save really posts to `POST /challenges`.
- **Durable backend**: challenge/attempt/report APIs, the scoring engine,
  and the event recorder (ordered event log with token-budget tracking,
  hard-stop flag, and a replay endpoint — `docs/EVENT_LOG_SCHEMA.md`) —
  all persisted in SQLite (survives restarts; `ROZARK_DB_PATH` override).
- **Live sandbox** (`docs/SANDBOX.md`): start a session from the attempt
  page and you get a real terminal (xterm.js + websocket PTY) into an
  isolated per-attempt workspace — commands, output, file edits and git
  snapshots are all recorded into the event log, and submit freezes the
  session. The proven path is the local-process backend; the Docker
  backend implements the same interface against
  `sandbox/Dockerfile.challenge` but has not been run on a Docker host
  yet. Still pending: the in-sandbox coding agent + budget proxy, and the
  Monaco editor (attempt-page panes other than the terminal remain
  labelled demo scaffold).

## License

MIT — see LICENSE.
