# Rozark — Event Log Schema

> **The event log is the product.** Every other piece of Rozark — the sandbox,
> the recorder, the budget proxy, the scoring engine, the replay page, and the
> candidate report — reads from or writes into **one ordered event log per
> session**. Design everything else around this document.

## Principles

1. **One log per session.** A session is one candidate attempt in one sandbox.
   All three capture streams — (a) terminal I/O, (b) file changes (watcher +
   git snapshots), (c) agent prompts/tool calls — are merged into a single
   ordered log, not three separate files.
2. **Append-only.** Events are never edited or deleted. Corrections are new
   events. A submitted session's log is frozen (see `session_submitted`).
3. **Monotonic ordering.** `seq` starts at 1 and increases by exactly 1 per
   event within a session. Wall-clock `ts` can skew; `seq` is the truth for
   ordering and replay.
4. **Every event carries its session.** `session_id` and `attempt_id` appear
   on *every* event, so a single event is self-describing out of context
   (e.g. when quoted as evidence in a report).
5. **Evidence, not vibes.** **Every score in a candidate report links to
   evidence event ids.** If a score cannot name the events that produced it,
   it does not belong in the report. Reviewers can click any score and land
   on the exact prompt, diff, or test run behind it.

## Envelope — fields on every event

| Field | Type | Notes |
|---|---|---|
| `id` | string | Globally unique, e.g. `evt_0042`. Assigned by the recorder at append time. |
| `seq` | int | Per-session sequence, 1-based, strictly +1. Mirrored as `sequence` in the current API for backward compatibility — they are always equal. |
| `ts` | string | ISO-8601 UTC timestamp assigned by the server/recorder when the event is appended (not by the client). |
| `type` | string | One of the event types below. |
| `actor` | enum | `candidate` \| `agent` \| `system`. Who caused the event, not who recorded it. |
| `session_id` | string | Session identifier. In the MVP, one session per attempt, so `session_id == attempt_id`; the field exists so multi-session attempts (retakes, reconnects) don't need a schema change. |
| `attempt_id` | string | The attempt this event belongs to. |
| `payload` | object | Type-specific, schemas below. Always an object, never null. |

Example envelope:

```json
{
  "id": "evt_0042",
  "seq": 42,
  "sequence": 42,
  "ts": "2026-10-22T04:31:07.412Z",
  "type": "prompt",
  "actor": "candidate",
  "session_id": "att_0007",
  "attempt_id": "att_0007",
  "payload": { "...": "type-specific, see below" }
}
```

## Phases

Prompts, token usage, and time are tagged by **phase** — the stage of work
the candidate was in. Phases are inferred by the recorder/agent adapter and
can be corrected by heuristics later; they are stored on the event, so the
report's "tokens by phase" and "prompts by phase" views are simple group-bys.

| Phase | Meaning |
|---|---|
| `planning` | Reading the brief, exploring, asking the agent to plan — before the first edit. |
| `building` | Writing/implementing code (prompts, edits, tool calls producing new behaviour). |
| `debugging` | Reacting to failures: failing tests, errors, stack traces, fix iterations. |

Payloads that carry a phase use the field name `phase`.

## Event types

### Session lifecycle

#### `session_started` — actor: `system`
Sandbox is up, repo loaded, clock starts.
```json
{ "challenge_id": "chal_0001", "sandbox_image": "rozark/challenge:backend-bugfix-api",
  "time_limit_minutes": 30, "token_budget": 100000, "allowed_agents": ["claude_code"] }
```

#### `brief_viewed` — actor: `candidate`
Candidate opened (or re-opened) the challenge brief.
```json
{ "section": "acceptance_criteria", "dwell_ms": 8200 }
```

#### `session_submitted` — actor: `candidate` (or `system` on timeout/budget freeze)
Final event of a live session. After this event the workspace is frozen and
the recorder rejects further candidate/agent events.
```json
{ "reason": "candidate_submit", "active_ms": 1542000, "tokens_used": 61240 }
```
`reason` ∈ `candidate_submit` | `time_expired` | `budget_exceeded`.

### Agent interaction (stream c)

#### `prompt` — actor: `candidate`
A prompt the candidate sent to the coding agent. **The single most valuable
event type in Rozark.**
```json
{ "text": "The /items endpoint duplicates rows across pages — inspect app/main.py and propose a fix",
  "phase": "debugging",
  "agent": "claude_code",
  "file_refs": ["app/main.py"],
  "mode": "agent" }
```
- `phase` ∈ `planning` | `building` | `debugging` (required).
- `file_refs`: files the candidate explicitly referenced/attached (may be `[]`).
- `mode`: `plan` | `agent` (mirrors the Plan/Agent toggle in the workspace UI).

#### `tool_call` — actor: `agent`
One tool invocation by the agent (file read, search, shell, edit tool, …).
```json
{ "tool": "read_file", "agent": "claude_code", "args_summary": "app/main.py",
  "status": "ok", "prompt_event_id": "evt_0042" }
```
`prompt_event_id` links the call back to the prompt that caused it.

#### `agent_response` — actor: `agent`
The agent's reply/completion for a prompt (summary form; full text may be
stored by reference in the sandbox, the log keeps the summary + ref).
```json
{ "prompt_event_id": "evt_0042", "summary": "Identified offset computed as page*size instead of (page-1)*size",
  "tokens_in": 1820, "tokens_out": 640 }
```

### Candidate work (streams a + b)

#### `file_view` — actor: `candidate`
```json
{ "path": "app/main.py", "via": "editor" }
```
`via` ∈ `editor` | `agent_tool` (agent reads are also `tool_call`s; this type
is for the candidate's own navigation in the file explorer/editor).

#### `file_edit` — actor: `candidate` or `agent`
A file changed on disk, captured by the filesystem watcher. Stores a **diff
reference**, not the whole file: the full content lives in the git snapshot.
```json
{ "path": "app/main.py", "actor_hint": "agent",
  "diff_ref": "snap_0003:app/main.py", "lines_added": 1, "lines_removed": 1,
  "snapshot_id": "snap_0003" }
```
`actor_hint` distinguishes hand-edits from agent-applied edits where the
watcher can tell (editor save vs. agent tool write); scoring uses this for
the hand-edit vs AI-output signal.

#### `terminal_cmd` — actor: `candidate` (or `agent` when run via agent shell tool)
```json
{ "command": "pytest -q tests/test_public.py", "cwd": "/workspace" }
```

#### `terminal_output` — actor: `system`
Output paired to a `terminal_cmd`.
```json
{ "cmd_event_id": "evt_0051", "exit_code": 1, "stdout_tail": "1 failed, 1 passed",
  "truncated": false }
```
Large outputs are tail-truncated in the log; the full stream lives in the
sandbox recording store and is referenced from the replay view.

> Backward compatibility: the legacy single type `terminal` from the first
> MVP scaffold is still accepted on ingest and treated as a `terminal_cmd`.

#### `test_run` — actor: `candidate` | `agent` | `system`
A test suite execution. Drives the functional score.
```json
{ "suite": "sample", "command": "pytest -q",
  "passed": 1, "failed": 1, "points_earned": 25, "points_possible": 50,
  "failing": [ { "test": "test_second_page_no_overlap",
                 "expected": "first id on page 2 is 6",
                 "actual": "first id on page 2 is 7" } ] }
```
- `suite` ∈ `sample` (visible to the candidate) | `hidden` (run by the system
  at submit; candidate sees points, not test source).
- `failing[].expected` / `actual` feed the report's "failing tests explained"
  card verbatim — capture them here, not at report time.

#### `git_snapshot` — actor: `system`
Periodic (few-second) and on-submit git snapshot of the workspace by the
recorder sidecar.
```json
{ "snapshot_id": "snap_0003", "commit_ref": "a1b2c3d", "files_changed": ["app/main.py"],
  "reason": "interval" }
```
`reason` ∈ `interval` | `edit_burst` | `submit`. `file_edit.diff_ref`s point
into these snapshots.

### Integrity signals (logged, not blocked — v1 honesty)

#### `paste_event` — actor: `candidate`
```json
{ "target": "editor", "chars": 412, "path": "app/main.py" }
```
#### `clipboard_event` — actor: `candidate`
```json
{ "action": "copy", "source": "terminal", "chars": 96 }
```
`action` ∈ `copy` | `cut` | `paste`. Paste into the *agent prompt box* is
recorded as `paste_event` with `target: "prompt"`.

#### `tab_switch` — actor: `candidate`
```json
{ "direction": "away", "away_ms": 34000 }
```
These three types are **evidence for the reviewer, not accusations**. Rozark
v1 logs them and surfaces them in the report timeline; it does not claim to
prove cheating (see `docs/SANDBOX.md` — honest limits).

### Budget & metering

#### `token_usage` — actor: `system` (emitted by the budget proxy)
One event per model call (or per agent turn, aggregated by the proxy).
```json
{ "agent": "claude_code", "model": "claude-sonnet",
  "phase": "debugging", "tokens_in": 1820, "tokens_out": 640, "tokens_total": 2460,
  "cumulative_tokens": 61240, "budget": 100000, "budget_remaining": 38760 }
```
`cumulative_tokens` and `budget_remaining` are denormalised onto the event so
the budget bar and the report never need to re-sum the log.

#### `budget_exceeded` — actor: `system`
Emitted once, the moment cumulative usage reaches the cap. The proxy stops
serving model calls (hard stop enforced at the proxy — see `docs/SANDBOX.md`),
and the recorder sets the attempt's `budget_exceeded` / hard-stop flags.
```json
{ "cumulative_tokens": 100120, "budget": 100000, "phase": "debugging" }
```

## Ordering & recorder guarantees

- The recorder is the **only writer**. Sandbox components (terminal bridge,
  watcher sidecar, agent adapter, proxy) submit events; the recorder assigns
  `id`, `seq`, and `ts`, then appends.
- Appends are serialised per session: no two events share a `seq`, no gaps.
- Reads for replay (`GET /attempts/{id}/replay`) return events sorted by
  `seq` plus the list of git snapshot refs, so the UI can scrub the session
  and restore file state at any point from the nearest snapshot + diffs.

## How scoring consumes this log

| Report element | Source events |
|---|---|
| Functional score | `test_run` (hidden suite) / JUnit / TAP / `FS_SCORE:` at submit |
| Prompting dimension | `prompt` (count, specificity, `file_refs`) |
| Exploration dimension | `file_view`, `tool_call` (reads/searches) before first `file_edit` |
| Verification dimension | `test_run` (sample), `terminal_cmd` after edits |
| Debugging dimension | edit → failing `test_run` → edit cycles |
| Independence dimension | `file_edit` with `actor_hint: candidate` vs agent edits; `paste_event` volume |
| Fit % / hire signals / concerns | Each signal cites the `prompt` / `git_snapshot` / failing `test_run` event ids behind it |
| Tokens vs budget by phase | `token_usage` grouped by `phase`; cap from `session_started` / `budget_exceeded` |
| Active time, time-to-first-edit, suite-green time | `session_started` → first `file_edit`; first `test_run` with `failed: 0` |

## Versioning

This is schema **v1**. New event types may be added; existing type payloads
only gain optional fields. Consumers must ignore unknown types and unknown
payload fields.
