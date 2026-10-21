import EventTimeline from "@/components/EventTimeline";

// ---------------------------------------------------------------------------
// Candidate report — HirePrise-style evidence cards (demo/mock data,
// clearly labelled). Every signal/concern links to the event behind it:
// a prompt, a git snapshot/commit, or a failing test run. Live data comes
// from GET /attempts/{id}/report + /replay (docs/EVENT_LOG_SCHEMA.md).
// ---------------------------------------------------------------------------

const demo = {
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

const phaseColor: Record<string, string> = { planning: "bg-sky-600", building: "bg-emerald-600", debugging: "bg-amber-600" };

export default function ReportPage({ params }: { params: { id: string } }) {
  const r = demo;
  const totalPrompts = r.promptsByPhase.reduce((a, p) => a + p.count, 0);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Candidate Report — {params.id}</h1>
        <p className="text-sm text-amber-300">{r.candidate} — layout + content modelled on HirePrise-style evidence cards. Live reports come from GET /attempts/{"{id}"}/report and /replay; every score below links to evidence event ids.</p>
      </div>

      {/* Fit + scores */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded border-2 border-indigo-500/60 p-4 text-center"><p className="text-sm text-gray-400">Fit</p><p className="text-4xl font-bold text-indigo-300">{r.fit}%</p><p className="mt-1 text-xs text-gray-500">weighted 40% functional + 60% AI collaboration</p></div>
        <div className="rounded border border-gray-700 p-4"><p className="text-sm text-gray-400">Functional</p><p className="text-3xl font-bold">{r.functional}</p><p className="text-xs text-gray-500">sample 50/50 · hidden 37.5/50</p></div>
        <div className="rounded border border-gray-700 p-4"><p className="text-sm text-gray-400">AI Collaboration</p><p className="text-3xl font-bold">{r.ai}</p><p className="text-xs text-gray-500">from recorded session events</p></div>
        <div className="rounded border border-gray-700 p-4"><p className="text-sm text-gray-400">Session</p><p className="text-sm">Active <strong>{r.metrics.activeTime}</strong></p><p className="text-sm">First edit <strong>{r.metrics.timeToFirstEdit}</strong></p><p className="text-sm">Sample green <strong>{r.metrics.sampleGreenAt}</strong></p><p className="text-xs text-gray-500">{r.metrics.prompts} prompts · {r.metrics.snapshots} git snapshots</p></div>
      </div>

      {/* Hire signals / concerns */}
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded border border-emerald-800/70 p-4">
          <h2 className="font-semibold text-emerald-300">Hire signals</h2>
          <ul className="mt-2 space-y-3">
            {r.signals.map((s) => (<li key={s.text} className="text-sm"><p>{s.text}</p><a href={s.ref} className="font-mono text-xs text-indigo-300 underline">↳ {s.evidence}</a></li>))}
          </ul>
        </section>
        <section className="rounded border border-red-800/70 p-4">
          <h2 className="font-semibold text-red-300">Concerns</h2>
          <ul className="mt-2 space-y-3">
            {r.concerns.map((s) => (<li key={s.text} className="text-sm"><p>{s.text}</p><a href={s.ref} className="font-mono text-xs text-indigo-300 underline">↳ {s.evidence}</a></li>))}
          </ul>
        </section>
      </div>

      {/* Prompts by phase + tokens */}
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded border border-gray-700 p-4">
          <h2 className="font-semibold">Prompts by phase — {totalPrompts} total</h2>
          <ul className="mt-2 space-y-2">
            {r.promptsByPhase.map((p) => (
              <li key={p.phase} className="text-sm">
                <div className="flex justify-between"><span className="capitalize">{p.phase}</span><strong>{p.count}</strong></div>
                <div className="mt-1 h-2 rounded bg-gray-800"><div className={`h-2 rounded ${phaseColor[p.phase]}`} style={{ width: `${(p.count / totalPrompts) * 100}%` }} /></div>
                <p className="text-xs text-gray-500">{p.note}</p>
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded border border-gray-700 p-4">
          <h2 className="font-semibold">Tokens vs budget</h2>
          <p className="mt-1 text-sm text-gray-300">{r.tokens.used.toLocaleString()} used of {r.tokens.cap.toLocaleString()} ({Math.round((r.tokens.used / r.tokens.cap) * 100)}%) — cap enforced at the budget proxy.</p>
          <ul className="mt-2 space-y-2">
            {(Object.keys(r.tokens.byPhase) as (keyof typeof r.tokens.byPhase)[]).map((p) => (
              <li key={p} className="text-sm">
                <div className="flex justify-between"><span className="capitalize">{p}</span><span>{r.tokens.byPhase[p].toLocaleString()}</span></div>
                <div className="mt-1 h-2 rounded bg-gray-800"><div className={`h-2 rounded ${phaseColor[p]}`} style={{ width: `${(r.tokens.byPhase[p] / r.tokens.cap) * 100}%` }} /></div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Failing tests explained */}
      <section className="rounded border border-gray-700 p-4">
        <h2 className="font-semibold">Failing tests — explained</h2>
        <div className="mt-2 space-y-3">
          {r.failingTests.map((t) => (
            <div key={t.test} className="rounded border border-gray-800 bg-gray-900 p-3 text-sm">
              <p className="font-mono text-xs text-red-300">{t.suite} · {t.test} <span className="text-gray-500">({t.event})</span></p>
              <p className="mt-1"><span className="text-gray-500">Expected:</span> {t.expected} · <span className="text-gray-500">Actual:</span> {t.actual}</p>
              <p className="mt-1 text-gray-400">{t.explanation}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Reviewer summary */}
      <section className="rounded border border-indigo-800/60 bg-indigo-950/30 p-4">
        <h2 className="font-semibold">Reviewer summary</h2>
        <p className="mt-1 text-sm leading-6 text-gray-200">{r.summary}</p>
      </section>

      {/* Dimension breakdown */}
      <section className="space-y-2">
        <h2 className="font-semibold">AI collaboration breakdown — every score links to evidence</h2>
        {r.breakdown.map((d) => (<div key={d.dimension} className="flex justify-between rounded border border-gray-700 p-3"><span>{d.dimension} — {d.notes} <span className="text-xs text-gray-500">evidence: {d.evidence.join(", ")}</span></span><strong>{d.score}</strong></div>))}
      </section>

      <section><h2 className="mb-2 font-semibold">Session replay (from the event log)</h2><EventTimeline events={r.timeline} /></section>
    </div>
  );
}
