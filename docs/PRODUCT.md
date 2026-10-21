# Rozark — Product

## Problem
AI coding agents (Claude Code, OpenAI Codex, Cursor) changed how software is built,
but hiring tests still ban AI or ignore it and score only final code. That misses
the skill companies now hire for: collaborating effectively with an agent.

Anthropic itself had to redesign its take-home after its own model could beat
most candidates — if the agent alone passes, the test measures the agent, not
the candidate.

## Product
A controlled assessment environment where candidates solve a real, multi-file
engineering challenge *with* real AI coding tools. Rozark records the session
(prompts, file views/edits, terminal commands, tool calls, test runs, agent
responses) and produces an evidence-backed report.

## Target users (v1)
- Startups in India hiring SDE interns / fresh graduates (high volume, weak
  resume/CGPA signal, cannot pay US enterprise assessment pricing).
- Hiring managers / founders who need a 3-minute, replayable view of how a
  candidate worked, not just a number.

## Wedges vs incumbents
1. Open-source / self-hostable (Frappe-inspired) — scoring logic is inspectable.
2. India-first pricing and intern/fresher challenge library.
3. Evidence, not just a score — timeline replay linked to every dimension.

## MVP scope (this scaffold)
- Challenge creation wizard modelled on HackerRank project questions.
- Attempt lifecycle: start -> record events -> submit -> report.
- Dual scoring engine (functional + AI collaboration) with parsers for
  JUnit XML, TAP, and `FS_SCORE:` custom scorers.
- Report view with dual scores and evidence timeline.
- One runnable sample challenge.

## Out of scope for MVP
Live sandboxed IDE/agent execution, proctoring, ATS pipeline, payments,
multi-tenant billing. These are stubs/placeholders where present.

## Business model (hypothesis, not implemented)
Open-source core; hosted SaaS per-assessment / per-seat pricing in INR;
BYO agent API key to control per-candidate token cost.
