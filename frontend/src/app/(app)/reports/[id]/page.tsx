import EventTimeline from "@/components/EventTimeline";
import { demoReport as demo, phaseColor } from "@/lib/demoReport";

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
