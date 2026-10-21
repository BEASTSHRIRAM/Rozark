# Rozark — Scoring Rubric

## Total
`Total = 0.40 * Functional + 0.60 * AI Collaboration` (weights configurable per challenge).

## Functional score (0-100)
Proportion of tests passed, parsed from:
- JUnit XML (`<testsuite tests=.. failures=.. errors=.. skipped=..>`),
- TAP (`ok` / `not ok` lines, plan `1..N`),
- or a custom scorer line `FS_SCORE: XY%`.
Equal weight per test case (HackerRank parity).

## AI Collaboration score (0-100) — transparent heuristics
Implemented in `backend/app/scoring.py`. Each dimension returns a score and the
event IDs used as evidence.

| Dimension | Weight in AI score | Signals (heuristics) |
|---|---|---|
| Prompting | 25% | >=1 prompt; more distinct prompts up to a cap; prompt length/specificity (mentions files, errors, constraints) |
| Exploration | 20% | Distinct files viewed before/while editing; breadth of repo exploration |
| Verification / Testing | 20% | Test runs count; running tests after edits; terminal verification commands |
| Debugging | 15% | Iterations: edit -> test -> edit cycles; responding to failures rather than one-shot submission |
| Independence / Code quality proxy | 20% | Edits not explained by a single agent dump score higher; own file edits, small iterative diffs, no events = 0 |

Caps prevent gaming by spamming events (e.g. prompting saturates, exploration
counts *distinct* files). Zero events -> 0: a submission with no recorded
process gets no process credit — that is the point of Rozark.

## Report
Per attempt: functional score, AI collaboration score + breakdown, total,
and a chronological timeline where each dimension links its evidence events.
