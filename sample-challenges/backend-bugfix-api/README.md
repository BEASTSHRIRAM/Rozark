# Sample Challenge: Fix the orders API pagination bug

**Type:** backend · **Difficulty:** medium · **Score:** 75 · **Recommended time:** 30 minutes

## Problem statement
`GET /items?page=<n>&size=<s>` should return distinct slices of a 20-item catalogue.
Right now pages overlap: page 2 repeats items from page 1. Find the bug, fix it,
and keep the public tests passing. Hidden tests also check the last page and
out-of-range pages.

## Commands (HackerRank-style IDE setup)
- Install: `pip install -r requirements.txt`
- Run: `python -m app.main`
- Test: `pytest -q`

## Files
- Default open: `README.md`, `app/main.py`
- Read-only: `README.md`
- Hidden: `tests/test_hidden.py` (not shipped in the candidate view; described in challenge.json)

Work *with* an AI coding agent (Claude Code / Codex) as you would on the job.
Your prompts, exploration, edits and test runs are part of the assessment.
