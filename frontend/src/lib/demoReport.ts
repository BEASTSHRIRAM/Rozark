// Demo/sample candidate report — Rozark's own sample data, used by the
// report page and the landing-page report preview. Clearly labelled as
// sample wherever it is rendered. Live reports come from the API.

export const demoReport = {
  candidate: "Demo Candidate — SAMPLE / MOCK DATA",
  fit: 73,
  functional: 75, ai: 71.7,
  signals: [
    { kind: "signal", text: "Planned before editing — first prompt asked for a plan and named the suspect file", evidence: "evt_0042 (prompt, planning)", ref: "#evt_0042" },
    { kind: "signal", text: "Verified with tests after every edit instead of trusting the agent", evidence: "evt_0061 (test_run, sample suite)", ref: "#evt_0061" },
    { kind: "signal", text: "Pushed back on a wrong agent suggestion and pointed at the real failure output", evidence: "evt_0071 (prompt, debugging)", ref: "#evt_0071" },
  ],
  concerns: [
    { kind: "concern", text: "One large paste into the editor (412 chars) with no matching prompt — reviewer should ask about it", evidence: "evt_0055 (paste_event)", ref: "#evt_0055" },
    { kind: "concern", text: "Hidden suite: 1 of 4 tests still failing at submit", evidence: "evt_0090 (test_run, hidden suite)", ref: "#evt_0090" },
    { kind: "concern", text: "First sample-test run happened late — 14 min in, after 3 edits", evidence: "evt_0061 (test_run)", ref: "#evt_0061" },
  ],
  promptsByPhase: [
    { phase: "planning", count: 2, note: "Both before the first edit — strong signal" },
    { phase: "building", count: 4, note: "Specific, file-referenced prompts" },
    { phase: "debugging", count: 3, note: "Quoted actual failure output twice" },
  ],
  failingTests: [
    { suite: "sample", test: "test_second_page_no_overlap", expected: "first id on page 2 is 6", actual: "first id on page 2 is 7", explanation: "Offset computed as page*size instead of (page-1)*size — the core bug. Fixed at evt_0066; sample suite green after.", event: "evt_0052" },
    { suite: "hidden", test: "hidden: last partial page", expected: "final page returns remaining 2 items", actual: "final page returns 5 items (wraps around)", explanation: "Edge case not covered by the fix. Points lost: 12.5 of 50 hidden points.", event: "evt_0090" },
  ],
  tokens: { cap: 100000, used: 61240, byPhase: { planning: 8420, building: 31180, debugging: 21640 } },
  metrics: { activeTime: "25m 42s", timeToFirstEdit: "4m 10s", sampleGreenAt: "18m 05s", prompts: 9, snapshots: 14 },
  summary: "Solid hire signal for a fresher/intern screen. The candidate worked the way strong AI-assisted engineers work: planned first, kept prompts specific and file-referenced, and verified with tests instead of accepting agent output blindly — including pushing back once with real failure output. Two things to probe in the follow-up interview: the unexplained 412-char paste (evt_0055) and the missed last-page edge case in the hidden suite. Token use was efficient — 61% of budget, heaviest in building, with a real debugging spend rather than one-shot prompting.",
  breakdown: [
    { dimension: "prompting", score: 78, notes: "9 prompts, phase-tagged, file-referenced", evidence: ["evt_0042", "evt_0071"] },
    { dimension: "exploration", score: 70, notes: "Viewed brief + app/main.py + tests before first edit", evidence: ["evt_0008", "evt_0019"] },
    { dimension: "verification_testing", score: 85, notes: "Test run after every edit cycle", evidence: ["evt_0061", "evt_0066"] },
    { dimension: "debugging", score: 72, notes: "2 edit → fail → edit cycles, quoted failure output", evidence: ["evt_0052", "evt_0071"] },
    { dimension: "independence", score: 58, notes: "Mostly agent edits; 1 large paste flagged", evidence: ["evt_0055", "evt_0066"] },
  ],
  timeline: [
    { id: "evt_0008", attempt_id: "att_demo", session_id: "att_demo", sequence: 8, seq: 8, ts: "2026-10-22T04:12:31Z", actor: "candidate", type: "brief_viewed", payload: { section: "acceptance_criteria" } },
    { id: "evt_0042", attempt_id: "att_demo", session_id: "att_demo", sequence: 42, seq: 42, ts: "2026-10-22T04:15:02Z", actor: "candidate", type: "prompt", payload: { phase: "planning", text: "Read the brief and app/main.py — where could pages overlap? Plan first." } },
    { id: "evt_0052", attempt_id: "att_demo", session_id: "att_demo", sequence: 52, seq: 52, ts: "2026-10-22T04:22:44Z", actor: "candidate", type: "test_run", payload: { suite: "sample", passed: 1, failed: 1 } },
    { id: "evt_0055", attempt_id: "att_demo", session_id: "att_demo", sequence: 55, seq: 55, ts: "2026-10-22T04:24:10Z", actor: "candidate", type: "paste_event", payload: { target: "editor", chars: 412, path: "app/main.py" } },
    { id: "evt_0066", attempt_id: "att_demo", session_id: "att_demo", sequence: 66, seq: 66, ts: "2026-10-22T04:29:37Z", actor: "system", type: "git_snapshot", payload: { snapshot_id: "snap_0009", commit_ref: "a1b2c3d", files_changed: ["app/main.py"] } },
    { id: "evt_0090", attempt_id: "att_demo", session_id: "att_demo", sequence: 90, seq: 90, ts: "2026-10-22T04:37:55Z", actor: "system", type: "test_run", payload: { suite: "hidden", passed: 3, failed: 1, points_earned: 37.5, points_possible: 50 } },
  ],
};

export const phaseColor: Record<string, string> = { planning: "bg-violet-500", building: "bg-cyan-400", debugging: "bg-amber-500" };
