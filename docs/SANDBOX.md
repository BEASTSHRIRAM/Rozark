# Rozark — Sandbox Architecture (1-day proof)

> Scope decision (2026-10-22): **sandbox-only is the demo.** It is the harder
> and more impressive half of Rozark, and the part that makes the evidence
> report real instead of a pasted transcript. This document scopes it to
> what one day can actually prove. Everything here writes into the event log
> defined in `docs/EVENT_LOG_SCHEMA.md` — that schema came first, on purpose.

## Status (updated 2026-10-22, increment 3)

**LIVE and proven on the dev machine (no Docker there, so the
local-process backend is the proven path):**

- **Durable store** — challenges / attempts / events / users persist in
  SQLite (`backend/app/store.py`, `ROZARK_DB_PATH` override, default
  `backend/rozark.db`). Proven: server restart reads data back.
- **Session manager** (`backend/app/sandbox.py`) —
  `POST /attempts/{id}/sandbox/start` materialises an isolated workspace
  per attempt (copy of the challenge starter, git-initialised, hidden
  test source never copied), starts the recorder watcher in-process
  (the sidecar's own scan/diff/snapshot functions), returns session info
  with `expires_at` from the challenge time limit.
- **WebSocket PTY** — `/ws/sandbox/{attempt_id}` is a real PTY (bash in
  the workspace), xterm.js in the browser, resize supported, and BOTH
  directions are tapped into the event log (`terminal_cmd` /
  `terminal_output`). Proven with a scripted WS client: `ls`/`echo`
  output, a `file_edit` event, interval + submit `git_snapshot`s.
- **Freeze on submit** — submit kills PTYs, stops the watcher, takes a
  final snapshot, then scores; WS connections after submit are rejected
  (error frame + close 4409) and event POSTs return 409.
- **Docker backend** — `DockerSandbox` implements the same interface
  against `sandbox/Dockerfile.challenge` (volume-mounted workspace,
  `docker exec` shells, resource caps). Code-complete but **not run on
  the dev VM (no docker CLI)**; if docker is requested but unavailable,
  start falls back to local and says so in `backend_note`.

**Still pending (next increments):**

- **Real agent inside the sandbox** (Claude Code first, Codex second) +
  the **budget proxy** (short-lived capped key, hard stop at the proxy,
  `token_usage` events from real model calls). The recorder-side budget
  accounting exists; no real model calls flow yet.
- Monaco editor wired to the live workspace files (attempt page panes
  other than the terminal are still labelled demo scaffold).
- Session expiry auto-submit on timeout (sessions expire + shells close;
  auto-submit on expiry is not wired).
- Docker path executed + egress allowlist enforced (needs a Docker host).

## What the sandbox must do

1. Give each candidate an **isolated environment** with the challenge repo
   already loaded and dependencies preinstalled.
2. Let them use a **real coding agent** inside it (Claude Code first, Codex
   second) — a terminal agent, not a chat widget.
3. **Record everything** — the sandbox is the source of evidence.
4. **Enforce limits**: time cap, token budget, restricted network.

## Components

```
Browser workspace                     Host (demo: local Docker)
┌────────────────────────────┐       ┌──────────────────────────────────┐
│ Monaco editor + explorer   │       │  One container per session       │
│ xterm.js terminal ◄──WS──► │──────►│  - challenge repo at /workspace  │
│ AI agent panel (Plan/Agent)│  PTY  │  - Claude Code CLI               │
│ Timer + token budget bar   │       │  - recorder sidecar (watcher +   │
└────────────────────────────┘       │    git snapshots -> event log)   │
        ▲ events / replay            │  - non-root user, CPU/mem caps   │
        │                            └──────────────┬───────────────────┘
┌───────┴────────────┐                            │ model calls only
│ Rozark backend     │◄──── budget proxy ◄────────┘
│ recorder (only     │       - short-lived, budget-capped key per session
│ writer of the log) │       - spend cap enforced HERE, not in the container
│ scoring + reports  │       - emits token_usage events per call
└────────────────────┘
```

### 1. Candidate workspace (browser)
- **Monaco** for the editor (VS Code-like tabs, explorer, status bar),
  **xterm.js** for the terminal, file explorer on the challenge repo.
- Three panes in the assessment view: brief (left) · code (middle) ·
  AI agent panel (right, Plan/Agent mode toggle). The agent itself runs in
  the container; the panel is a view onto its session + the terminal.
- Countdown timer (from `agent_config.time_limit_minutes`) and a token
  budget bar fed by `token_usage` events.

### 2. Runtime (per-session container)
- One Docker container per session, started from the **challenge image**
  (`sandbox/Dockerfile.challenge`): repo preloaded at `/workspace`,
  dependencies preinstalled at image build time (no slow/networked setup
  during the assessment), runs as a **non-root user**, with CPU and memory
  limits, e.g.:
  ```bash
  docker run -d --name rozark-<session_id> \
    --user candidate --cpus=1 --memory=1g --pids-limit=256 \
    --network rozark-egress \
    -e ROZARK_SESSION_ID=<session_id> -e ROZARK_BACKEND_URL=<backend> \
    rozark/challenge:<challenge_slug>
  ```
- **No real secrets in the image. Ever.** The image contains code and tools
  only. The model key the agent uses is short-lived and injected via the
  proxy (below), never baked in or shown to the candidate.
- Hosted runtimes (cloud container service, Firecracker microVMs) are the
  production path — the container contract (image + sidecar + proxy) is
  designed to carry over unchanged. Local Docker is the demo.

### 3. Agent inside the sandbox
- Claude Code is installed in the challenge image and runs in the container
  terminal, so candidates drive a real agent against a real repo.
  > **TODO (verify before building the image):** check the current official
  > Claude Code documentation for the exact headless/non-interactive config,
  > settings-file format, and how it reads API credentials from the
  > environment. Do not guess the config and do not hardcode any key.
  > See the placeholder + TODO in `sandbox/Dockerfile.challenge`.
- The candidate never sees a real API key: the backend issues a
  **short-lived, budget-capped credential per session**, and all model calls
  route through the **budget proxy**:
  - Proxy checks cumulative spend for the session **before** forwarding.
  - On reaching the cap, the proxy refuses further calls (**hard stop at the
    proxy** — a runaway agent inside the container cannot spend past it,
    because it has no other route to the model API) and emits
    `budget_exceeded`.
  - Every call emits a `token_usage` event (tokens in/out, phase, cumulative
    vs budget) into the recorder.
- Codex support comes second, through the same proxy + adapter contract:
  an agent adapter translates each agent's own session log into Rozark
  `prompt` / `tool_call` / `agent_response` events.

### 4. Recording layer — the heart of Rozark
Three streams, one ordered log (schema: `docs/EVENT_LOG_SCHEMA.md`):
- **(a) Terminal I/O** — the PTY bridge taps input/output into
  `terminal_cmd` / `terminal_output` events.
- **(b) File changes** — the recorder sidecar (`sandbox/recorder_sidecar.py`)
  watches the workspace, emits `file_edit` events with diff refs, and takes
  **git snapshots every few seconds** (`git_snapshot` events) so any moment
  can be reconstructed.
- **(c) Agent prompts & tool calls** — parsed from the agent's own session
  log by its adapter into `prompt` (phase-tagged) / `tool_call` /
  `agent_response` events.
- The backend **recorder is the only writer**: it assigns `id`, `seq`, `ts`
  and appends. Components submit; they never write the log directly.

### 5. Controls
- **Countdown timer** — at zero, the backend appends `session_submitted`
  (`reason: time_expired`) and freezes the workspace.
- **Token/cost ceiling** — enforced at the proxy (above). The UI budget bar
  is a display; the proxy is the enforcement.
- **Egress allowlist** — the container network allows only: the budget
  proxy, the Rozark backend (events), and package mirrors needed by the
  challenge. No general internet. This is also what makes the proxy cap
  unbypassable.
- **Submit** — freezes the workspace (container stopped read-only / killed),
  appends `session_submitted`, triggers the hidden test suite + scoring.

### 6. Session replay
- `GET /attempts/{id}/replay` returns the ordered event log + git snapshot
  refs. The replay page scrubs through events and restores file state from
  the nearest snapshot + diffs.
- Visual polish (animated file changes, Three.js/GSAP-style presentation)
  is the **last layer**. A plain, accurate replay beats a pretty, wrong one.

## WebSocket PTY — known-hard part
Streaming a PTY to xterm.js over a websocket works well, but **budget ~1
hour for resize and reconnect bugs**: terminal resize (`SIGWINCH`) sync,
reconnect without losing the shell or duplicating output, and backpressure
on fast output. Keep the bridge dumb: bytes in, bytes out, plus the tap into
the recorder. Test resize/reconnect explicitly before demo day.

## Honest limits (say these plainly)
- **Cost control is the #1 risk.** A runaway agent burns money fast. The
  only trustworthy enforcement point is the proxy — never trust in-container
  accounting for the cap.
- **Security.** Candidates run arbitrary code. Container limits (non-root,
  CPU/mem/pids caps, egress allowlist, no secrets in the image) are the v1
  boundary. This is a demo-grade boundary, not a hardened multi-tenant one.
- **Cheating is not solved in v1.** Someone can still get outside help and
  paste it in. Rozark v1 **logs** paste/clipboard/tab-switch events and
  shows them to the reviewer as evidence — it does not claim to prevent or
  prove cheating. A day will not solve this; don't pretend otherwise.
- **Terminal fidelity** — see the PTY note above (~1 hr of bugs is normal).

## Build order for the day
1. Container with the challenge repo + Claude Code running, reachable from
   your own terminal.
2. WebSocket terminal in the browser (xterm.js + PTY bridge).
3. **Recorder**: terminal stream + git snapshots + agent log → event log.
4. Budget proxy + session timer.
5. Basic replay page (ordered log + snapshot restore).
6. Demo challenge repo: one real bug, a few sample tests, hidden suite.

**If time runs short: cut the replay visuals first. Never cut the
recorder.** The recording is what makes the platform valuable — a Rozark
without it is just another coding test with a chat box.
