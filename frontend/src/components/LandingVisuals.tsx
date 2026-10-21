// Pure JSX/CSS product visuals for the landing page — no stock images.
// A stylised render of Rozark's real assessment workspace: brief + files
// on the left, code in the middle, the AI agent panel on the right, and
// the sample-tests bar underneath. Sample content, Rozark's own sample
// challenge (the orders-API pagination bug).

const kw = "text-violet-300";
const fn = "text-sky-300";
const str = "text-emerald-300";
const cm = "text-gray-500 italic";
const pl = "text-gray-200";
const num = "text-amber-300";

function CodeLine({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="gs-code-line flex gap-3 leading-5">
      <span className="w-5 shrink-0 select-none text-right text-[10px] leading-5 text-gray-600">{n}</span>
      <span className="whitespace-pre">{children}</span>
    </div>
  );
}

export function MockAssessmentWindow() {
  return (
    <div className="overflow-hidden rounded-2xl border border-fuchsia-400/20 bg-[#0d1326] shadow-2xl shadow-fuchsia-950/50">
      {/* window chrome */}
      <div className="flex items-center gap-2 border-b border-white/5 bg-white/[0.03] px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
        <span className="ml-3 font-mono text-[11px] text-gray-400">rozark — assessment · Fix the orders API pagination bug</span>
        <span className="ml-auto hidden items-center gap-2 sm:flex">
          <span className="rounded-md bg-amber-500/15 px-2 py-0.5 font-mono text-[11px] text-amber-300">⏱ 24:18 left</span>
          <span className="gs-token-chip rounded-md bg-cyan-500/15 px-2 py-0.5 font-mono text-[11px] text-cyan-300">tokens 61,240 / 100,000</span>
        </span>
      </div>

      <div className="grid md:grid-cols-[150px_1fr_190px]">
        {/* explorer */}
        <div className="hidden border-r border-white/5 p-3 font-mono text-[11px] leading-6 text-gray-400 md:block">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Explorer</p>
          <p className="text-gray-300">▾ project</p>
          <p className="pl-3">▸ .vscode</p>
          <p className="pl-3 text-gray-300">▾ app</p>
          <p className="pl-6 rounded bg-indigo-500/20 text-indigo-200">main.py ●</p>
          <p className="pl-6">models.py</p>
          <p className="pl-3">▸ tests</p>
          <p className="pl-3">package.json</p>
          <p className="pl-3 text-gray-500">README.md 🔒</p>
          <div className="mt-4 rounded-lg border border-white/5 bg-white/[0.02] p-2 font-sans text-[10px] leading-4 text-gray-400">
            <p className="font-semibold text-gray-200">Ticket #482</p>
            <p className="mt-1">Merchants see duplicate orders when paging. Fix it, keep the response shape.</p>
          </div>
        </div>

        {/* code */}
        <div className="p-3 font-mono text-[11px]">
          <div className="mb-2 flex gap-1.5 text-[10px]">
            <span className="rounded-t bg-white/[0.06] px-2 py-1 text-gray-200">main.py ●</span>
            <span className="px-2 py-1 text-gray-500">README.md</span>
          </div>
          <CodeLine n={1}><span className={cm}># Orders API — pagination</span></CodeLine>
          <CodeLine n={2}><span className={kw}>from</span> <span className={pl}>fastapi</span> <span className={kw}>import</span> <span className={pl}>FastAPI</span></CodeLine>
          <CodeLine n={3}><span className={pl}> </span></CodeLine>
          <CodeLine n={4}><span className={kw}>def</span> <span className={fn}>list_items</span><span className={pl}>(page: </span><span className={fn}>int</span><span className={pl}>, size: </span><span className={fn}>int</span><span className={pl}>):</span></CodeLine>
          <CodeLine n={5}><span className={pl}>    offset = (page - </span><span className={num}>1</span><span className={pl}>) * size</span> <span className={cm}># fixed ✓</span></CodeLine>
          <CodeLine n={6}><span className={pl}>    items = DB[</span><span className={pl}>offset : offset + size</span><span className={pl}>]</span></CodeLine>
          <CodeLine n={7}><span className={kw}>    return</span> <span className={pl}>{"{"}</span><span className={str}>"items"</span><span className={pl}>: items,</span></CodeLine>
          <CodeLine n={8}><span className={pl}>            </span><span className={str}>"page"</span><span className={pl}>: page, </span><span className={str}>"total"</span><span className={pl}>: </span><span className={fn}>len</span><span className={pl}>(DB){"}"}</span></CodeLine>
          {/* sample tests bar */}
          <div className="mt-4 rounded-lg border border-white/5 bg-white/[0.02] p-2.5 font-sans text-[11px]">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-gray-200">Sample tests</span>
              <span className="font-mono text-[10px] text-gray-500">hidden suite · graded on submit</span>
            </div>
            <ul className="mt-1.5 space-y-1 text-gray-300">
              <li className="gs-test-row">✓ first page returns the first 5 items <span className="float-right font-mono text-emerald-300">passed · 8 pts</span></li>
              <li className="gs-test-row">✓ page 2 starts at item 6 — no overlap <span className="float-right font-mono text-emerald-300">passed · 9 pts</span></li>
              <li className="gs-test-row">✓ duplicate emails rejected across pages <span className="float-right font-mono text-emerald-300">passed · 7 pts</span></li>
            </ul>
          </div>
        </div>

        {/* AI panel */}
        <div className="hidden border-l border-white/5 p-3 md:block">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold text-gray-200">AI agent</p>
            <span className="flex overflow-hidden rounded-md border border-white/10 text-[10px]">
              <span className="bg-violet-600 px-2 py-0.5 text-white">Plan</span>
              <span className="px-2 py-0.5 text-gray-400">Agent</span>
            </span>
          </div>
          <div className="mt-2.5 space-y-2 text-[11px] leading-4">
            <div className="gs-agent-card rounded-lg bg-white/[0.04] p-2 text-gray-300">
              <span className="mb-1 inline-block rounded bg-violet-500/25 px-1.5 py-px font-mono text-[9px] text-sky-300">planning</span>
              <p>Read the brief and app/main.py — where could pages overlap? Plan first, no edits yet.</p>
            </div>
            <div className="gs-agent-card rounded-lg bg-indigo-500/10 p-2 text-gray-300">
              <p className="text-indigo-200">The offset uses <span className="font-mono">page * size</span>, so page 2 starts at item 11, not 6 — and page 1 skips the first items. One-line fix, then run the sample suite.</p>
            </div>
            <div className="gs-agent-card rounded-lg bg-white/[0.04] p-2 text-gray-300">
              <span className="mb-1 inline-block rounded bg-amber-500/25 px-1.5 py-px font-mono text-[9px] text-amber-300">debugging</span>
              <p>That suggestion breaks 1-indexing. The failing test says page 2 must start at 6 — fixing it as (page − 1) * size instead.</p>
            </div>
          </div>
          <p className="mt-3 font-mono text-[9px] leading-4 text-gray-600">every prompt, edit &amp; test run is recorded to the session event log</p>
        </div>
      </div>

      {/* status bar */}
      <div className="flex items-center gap-4 border-t border-white/5 bg-indigo-950/40 px-4 py-1.5 font-mono text-[10px] text-gray-400">
        <span>⑂ main*</span><span>⊗ 0</span><span>⚠ 0</span>
        <span className="ml-auto">Ln 5, Col 22 · Python · session recording ●</span>
      </div>
    </div>
  );
}

export function MiniVisual({ kind }: { kind: "brief" | "agent" | "tests" }) {
  if (kind === "brief") {
    return (
      <div className="rounded-xl border border-white/10 bg-[#0d1326] p-4 font-mono text-[11px] leading-5 text-gray-400">
        <p className="font-sans text-xs font-semibold text-gray-200">Ticket #482 — Duplicate orders in pagination</p>
        <p className="mt-2"><span className="text-gray-500">from:</span> support@merchant</p>
        <p><span className="text-gray-500">rules:</span> 1-indexed pages · no overlap · shape unchanged</p>
        <p><span className="text-gray-500">accept:</span> page 2 starts at item 6 ✓</p>
        <p className="mt-2 text-emerald-300">▸ a real repo, already running — not an empty editor</p>
      </div>
    );
  }
  if (kind === "agent") {
    return (
      <div className="space-y-2 rounded-xl border border-white/10 bg-[#0d1326] p-4 text-[11px] leading-4">
        <div className="flex justify-between font-mono text-[10px] text-gray-500"><span>PROMPTS BY PHASE</span><span>9 total</span></div>
        {[
          { p: "planning", n: 2, c: "bg-violet-500", w: "22%" },
          { p: "building", n: 4, c: "bg-cyan-400", w: "44%" },
          { p: "debugging", n: 3, c: "bg-amber-500", w: "33%" },
        ].map((r) => (
          <div key={r.p}>
            <div className="flex justify-between text-gray-300"><span className="capitalize">{r.p}</span><span>{r.n}</span></div>
            <div className="mt-1 h-1.5 rounded bg-white/5"><div className={`h-1.5 rounded ${r.c}`} style={{ width: r.w }} /></div>
          </div>
        ))}
        <p className="pt-1 font-mono text-[10px] text-gray-500">hand-edits vs agent output · pushback · tests-first — all measured</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-white/10 bg-[#0d1326] p-4 text-[11px]">
      <div className="flex justify-between"><span className="font-semibold text-gray-200">Sample suite</span><span className="font-mono text-emerald-300">3 / 3 green</span></div>
      <div className="mt-2 space-y-1.5 text-gray-300">
        <p>✓ test_first_page <span className="float-right font-mono text-gray-500">8 pts</span></p>
        <p>✓ test_second_page_no_overlap <span className="float-right font-mono text-gray-500">9 pts</span></p>
        <p>✓ test_response_shape <span className="float-right font-mono text-gray-500">7 pts</span></p>
      </div>
      <div className="mt-3 flex justify-between border-t border-white/5 pt-2"><span className="font-semibold text-gray-200">Hidden suite</span><span className="font-mono text-gray-400">graded on submit · 50 pts</span></div>
    </div>
  );
}
