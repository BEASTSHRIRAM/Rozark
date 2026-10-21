"use client";
import { useState } from "react";
import Link from "next/link";
import SandboxTerminal from "@/components/SandboxTerminal";

// ---------------------------------------------------------------------------
// Attempt workspace — HirePrise-inspired 3-pane layout.
// Brief LEFT · Code/files MIDDLE · AI agent panel RIGHT.
// The TERMINAL at the bottom of the middle pane is LIVE (increment 3):
// a real websocket PTY into a per-attempt sandbox workspace, recorded
// into the event log (docs/SANDBOX.md). The brief/code/agent panes are
// still clearly-labelled demo/mock data rendered in the target layout;
// Monaco, the countdown timer, and the in-sandbox agent come next.
// ---------------------------------------------------------------------------

const DEMO = {
  title: "Fix the orders API pagination bug",
  brief: "The /items endpoint returns duplicate items across pages. Merchants see the same order twice when paging through results. Find and fix the bug, keep the public tests passing, and do not change the API response shape.",
  businessRules: [
    "Pagination is 1-indexed: page 1 is the first page.",
    "Pages must never overlap and must cover all items exactly once.",
    "Response shape { items, page, size, total } must not change.",
  ],
  acceptance: [
    "GET /items?page=2&size=5 starts at item 6 (no overlap with page 1).",
    "All sample tests pass; hidden suite runs at submit.",
    "Fix is in application code — editing tests is read-only blocked.",
  ],
  files: ["README.md", "app/main.py", "app/__init__.py", "requirements.txt", "tests/test_public.py"],
  readOnly: ["README.md", "tests/test_public.py"],
  defaultFile: "app/main.py",
  codePreview: [
    "def list_items(page: int = 1, size: int = 5):",
    "    start = page * size  # suspect: off-by-one?",
    "    return ITEMS[start:start + size]",
  ],
  sampleTests: [
    { name: "test_first_page", status: "passed", points: 25 },
    { name: "test_second_page_no_overlap", status: "failed", points: 25 },
  ],
  hiddenSuite: { tests: 4, points: 50, note: "Runs at submit. Points only — test source is never shown." },
  timeLimitMin: 30,
  timeLeftMin: 21,
  budget: { used: 61240, cap: 100000, byPhase: { planning: 8420, building: 31180, debugging: 21640 } },
  prompts: [
    { id: "evt_0042", phase: "planning", mode: "plan", text: "Read the brief and app/main.py — where could pages overlap? Give me a plan first." },
    { id: "evt_0058", phase: "building", mode: "agent", text: "Apply the offset fix you proposed and run the public tests." },
    { id: "evt_0071", phase: "debugging", mode: "agent", text: "Page 2 still starts at 7 in the test output — check the actual failure, don't guess." },
  ],
};

// Muted phase accents — functional micro-accents inside product UI only.
const phaseColor: Record<string, string> = { planning: "bg-violet-400/70", building: "bg-cyan-300/60", debugging: "bg-amber-400/70" };

function BudgetBar() {
  const b = DEMO.budget;
  const pct = (n: number) => `${Math.min(100, (n / b.cap) * 100).toFixed(1)}%`;
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-400">
        <span>Token budget (demo)</span>
        <span>{b.used.toLocaleString()} / {b.cap.toLocaleString()}</span>
      </div>
      <div className="mt-1 flex h-2.5 w-full overflow-hidden rounded bg-gray-800" title="Tokens by phase">
        {(Object.keys(b.byPhase) as (keyof typeof b.byPhase)[]).map((p) => (
          <div key={p} className={phaseColor[p]} style={{ width: pct(b.byPhase[p]) }} title={`${p}: ${b.byPhase[p].toLocaleString()}`} />
        ))}
      </div>
      <div className="mt-1 flex gap-3 text-[11px] text-gray-500">
        {(Object.keys(b.byPhase) as (keyof typeof b.byPhase)[]).map((p) => (
          <span key={p}><span className={`mr-1 inline-block h-2 w-2 rounded-sm ${phaseColor[p]}`} />{p} {b.byPhase[p].toLocaleString()}</span>
        ))}
      </div>
    </div>
  );
}

export default function AttemptPage({ params }: { params: { id: string } }) {
  const [mode, setMode] = useState<"plan" | "agent">("agent");
  const elapsedPct = ((DEMO.timeLimitMin - DEMO.timeLeftMin) / DEMO.timeLimitMin) * 100;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">{DEMO.title} <span className="text-sm font-normal text-gray-500">— attempt {params.id}</span></h1>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="font-mono text-lg leading-none">{DEMO.timeLeftMin}:00 <span className="text-xs text-gray-500">left of {DEMO.timeLimitMin}m (demo timer)</span></p>
            <div className="mt-1 h-1.5 w-40 rounded bg-gray-800"><div className="h-1.5 rounded bg-indigo-500" style={{ width: `${elapsedPct}%` }} /></div>
          </div>
          <button className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold" title="Scaffold: submit freezes the workspace — see docs/SANDBOX.md">Submit (scaffold)</button>
        </div>
      </div>
      <p className="rounded border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-gray-300">
        The <strong className="text-gray-100">terminal below the code pane is live</strong>: Start opens a real sandbox
        workspace for this attempt (isolated copy of the challenge project, git-initialised) and streams a websocket PTY
        into it — commands, output, file edits and git snapshots are recorded to the event log. The brief, code preview,
        timer, budget bar and agent panel are still demo/mock scaffold in the target 3-pane layout (Monaco editor +
        in-sandbox agent are next — docs/SANDBOX.md).
      </p>
      <div className="w-full max-w-md"><BudgetBar /></div>

      <div className="grid gap-4 xl:grid-cols-[300px_1fr_340px]">
        {/* LEFT — brief */}
        <section className="space-y-4 rounded border border-gray-700 p-4">
          <div>
            <h2 className="font-semibold">Brief</h2>
            <p className="mt-1 text-sm text-gray-300">{DEMO.brief}</p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-200">Business rules</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-gray-400">
              {DEMO.businessRules.map((r) => <li key={r}>{r}</li>)}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-200">Acceptance criteria</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-gray-400">
              {DEMO.acceptance.map((r) => <li key={r}>{r}</li>)}
            </ul>
          </div>
          <div className="rounded border border-gray-800 bg-gray-900 p-3">
            <h3 className="text-sm font-semibold">Sample tests</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {DEMO.sampleTests.map((t) => (
                <li key={t.name} className="flex justify-between">
                  <span className="font-mono text-xs">{t.name}</span>
                  <span className={t.status === "passed" ? "text-emerald-400" : "text-red-400"}>{t.status} · {t.points} pts</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 border-t border-gray-800 pt-2 text-xs text-gray-500">
              Hidden suite: {DEMO.hiddenSuite.tests} tests · {DEMO.hiddenSuite.points} pts. {DEMO.hiddenSuite.note}
            </p>
          </div>
        </section>

        {/* MIDDLE — code / files (VS Code-like scaffold) */}
        <section className="overflow-hidden rounded border border-gray-700">
          <div className="flex border-b border-gray-700 bg-gray-900 text-xs">
            <span className="border-r border-gray-700 bg-gray-950 px-3 py-2 font-mono text-indigo-300">{DEMO.defaultFile} ●</span>
            <span className="px-3 py-2 font-mono text-gray-500">tests/test_public.py (read-only)</span>
          </div>
          <div className="grid grid-cols-[170px_1fr]">
            <aside className="border-r border-gray-800 bg-gray-900/60 p-2">
              <p className="px-1 text-[11px] uppercase tracking-wide text-gray-500">Explorer</p>
              <ul className="mt-1 space-y-0.5 font-mono text-xs">
                {DEMO.files.map((f) => (
                  <li key={f} className={`rounded px-1 py-0.5 ${f === DEMO.defaultFile ? "bg-gray-800 text-gray-100" : "text-gray-400"}`}>
                    {f}{DEMO.readOnly.includes(f) ? <span className="ml-1 text-[10px] text-gray-600">ro</span> : null}
                  </li>
                ))}
              </ul>
              <p className="mt-3 px-1 text-[11px] text-gray-600">File explorer is a static preview — the live terminal below works in the real workspace.</p>
            </aside>
            <div className="bg-gray-950 p-3">
              <pre className="font-mono text-xs leading-6 text-gray-200">{DEMO.codePreview.map((l, i) => <div key={i}><span className="mr-3 text-gray-600">{i + 1}</span>{l}</div>)}</pre>
              <p className="mt-3 text-[11px] text-gray-600">Monaco editor in the live build — this is a static preview (scaffold).</p>
            </div>
          </div>
          <div className="border-t border-gray-700 bg-gray-900/60 p-3">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Sandbox terminal — live</p>
            <SandboxTerminal attemptId={params.id} submitted={false} />
          </div>
          <div className="flex justify-between border-t border-gray-700 bg-white/[0.02] px-3 py-1 text-[11px] text-gray-300">
            <span>main · rozark-sandbox</span><span>Python 3.12 · UTF-8 · recorded ●</span>
          </div>
        </section>

        {/* RIGHT — AI agent panel */}
        <section className="space-y-3 rounded border border-gray-700 p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">AI Agent</h2>
            <div className="flex rounded border border-gray-600 text-xs" role="group" aria-label="Agent mode">
              {(["plan", "agent"] as const).map((m) => (
                <button key={m} onClick={() => setMode(m)} className={`px-3 py-1 capitalize ${mode === m ? "bg-indigo-600 text-white" : "text-gray-400"}`}>{m}</button>
              ))}
            </div>
          </div>
          <p className="text-xs text-gray-500">
            Mode: <strong className="text-gray-300 capitalize">{mode}</strong> — {mode === "plan" ? "agent proposes, candidate approves before edits." : "agent may edit and run tools directly."}
            Scaffold: in the live sandbox this panel drives Claude Code inside the container via the budget proxy; the real agent is a terminal agent, not this chat view.
          </p>
          <ul className="space-y-2">
            {DEMO.prompts.map((p) => (
              <li key={p.id} className="rounded border border-gray-800 bg-gray-900 p-2.5">
                <p className="text-[11px] text-gray-500"><span className={`mr-1 inline-block h-2 w-2 rounded-sm ${phaseColor[p.phase]}`} />{p.phase} · {p.mode} mode · <span className="font-mono">{p.id}</span></p>
                <p className="mt-1 text-sm text-gray-200">{p.text}</p>
              </li>
            ))}
          </ul>
          <div className="rounded border border-dashed border-gray-700 p-3 text-sm text-gray-500">Prompt box (scaffold) — every prompt is recorded as a phase-tagged event.</div>
        </section>
      </div>

      <Link className="text-sm text-indigo-300" href={`/reports/${params.id}`}>View evidence report →</Link>
    </div>
  );
}
