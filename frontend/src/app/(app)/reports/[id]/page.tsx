"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import EventTimeline from "@/components/EventTimeline";
import { demoReport as demo, phaseColor } from "@/lib/demoReport";
import { fetchAttempt, fetchReport } from "@/lib/api";
import type { Attempt, Report } from "@/lib/types";

// Candidate report — LIVE from GET /attempts/{id}/report (with token
// by-phase from GET /attempts/{id}). If the live report cannot be loaded
// (attempt not submitted, or backend offline), the demo report renders
// ONLY behind a visible amber banner saying exactly that.

function fmtDur(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

function LiveReport({ id, r, attempt }: { id: string; r: Report; attempt: Attempt | null }) {
  const m = r.metrics;
  const promptsByPhase = m ? Object.entries(m.prompts_by_phase || {}) : [];
  const totalPrompts = m?.prompts_total ?? promptsByPhase.reduce((a, [, n]) => a + n, 0);
  const tokensByPhase = attempt ? Object.entries(attempt.tokens_by_phase || {}) : [];
  const tokenCap = m?.token_budget ?? attempt?.token_budget ?? 0;
  const tokenUsed = m?.tokens_used ?? attempt?.tokens_used ?? 0;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Candidate Report — {r.candidate_name}</h1>
        <p className="text-sm text-gray-400">Attempt {r.attempt_id} · challenge {r.challenge_id} · live data from GET /attempts/{id}/report. Every score links to evidence event ids.</p>
        <Link className="mt-1 inline-block text-sm text-cobaltlt" href={`/attempts/${id}/replay`}>Watch session replay →</Link>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded border-2 border-vermillion/60 p-4 text-center"><p className="text-sm text-gray-400">Fit</p><p className="text-4xl font-bold text-cobaltlt">{r.total_score}%</p><p className="mt-1 text-xs text-gray-500">weighted functional + AI collaboration</p></div>
        <div className="rounded border border-gray-700 p-4"><p className="text-sm text-gray-400">Functional</p><p className="text-3xl font-bold">{r.functional_score}</p><p className="text-xs text-gray-500">from the scoring run at submit</p></div>
        <div className="rounded border border-gray-700 p-4"><p className="text-sm text-gray-400">AI Collaboration</p><p className="text-3xl font-bold">{r.ai_collaboration_score}</p><p className="text-xs text-gray-500">from recorded session events</p></div>
        <div className="rounded border border-gray-700 p-4"><p className="text-sm text-gray-400">Session</p>
          {m ? (<>
            <p className="text-sm">Duration <strong>{fmtDur(m.duration_seconds)}</strong></p>
            <p className="text-sm">First edit <strong>{fmtDur(m.time_to_first_edit_seconds)}</strong></p>
            <p className="text-xs text-gray-500">{m.prompts_total} prompts · {m.test_runs} test runs · {m.files_edited} files edited · {m.git_snapshots} git snapshots</p>
          </>) : <p className="text-sm text-gray-500">Session metrics not included in this report.</p>}
        </div>
      </div>

      {(r.signals?.length || r.concerns?.length) ? (
        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded border border-sage/40 p-4">
            <h2 className="font-semibold text-sagelt">Hire signals</h2>
            <ul className="mt-2 space-y-3">
              {(r.signals || []).map((s) => (<li key={s.text} className="text-sm"><p>{s.text}</p>{s.evidence_event_ids.length ? <p className="font-mono text-xs text-cobaltlt">↳ evidence: {s.evidence_event_ids.join(", ")}</p> : null}</li>))}
              {!r.signals?.length && <li className="text-sm text-gray-500">None recorded.</li>}
            </ul>
          </section>
          <section className="rounded border border-red-800/70 p-4">
            <h2 className="font-semibold text-red-300">Concerns</h2>
            <ul className="mt-2 space-y-3">
              {(r.concerns || []).map((s) => (<li key={s.text} className="text-sm"><p>{s.text}</p>{s.evidence_event_ids.length ? <p className="font-mono text-xs text-cobaltlt">↳ evidence: {s.evidence_event_ids.join(", ")}</p> : null}</li>))}
              {!r.concerns?.length && <li className="text-sm text-gray-500">None recorded.</li>}
            </ul>
          </section>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded border border-gray-700 p-4">
          <h2 className="font-semibold">Prompts by phase — {totalPrompts} total</h2>
          {promptsByPhase.length ? (
            <ul className="mt-2 space-y-2">
              {promptsByPhase.map(([phase, count]) => (
                <li key={phase} className="text-sm">
                  <div className="flex justify-between"><span className="capitalize">{phase}</span><strong>{count}</strong></div>
                  <div className="mt-1 h-2 rounded bg-gray-800"><div className={`h-2 rounded ${phaseColor[phase] || "bg-gray-500"}`} style={{ width: `${totalPrompts ? (count / totalPrompts) * 100 : 0}%` }} /></div>
                </li>
              ))}
            </ul>
          ) : <p className="mt-1 text-sm text-gray-500">Prompt metrics not included in this report.</p>}
        </section>
        <section className="rounded border border-gray-700 p-4">
          <h2 className="font-semibold">Tokens vs budget</h2>
          <p className="mt-1 text-sm text-gray-300">{tokenUsed.toLocaleString()} used of {tokenCap.toLocaleString()}{tokenCap ? ` (${Math.round((tokenUsed / tokenCap) * 100)}%)` : ""} — cap enforced at the budget proxy.</p>
          {tokensByPhase.length ? (
            <ul className="mt-2 space-y-2">
              {tokensByPhase.map(([phase, n]) => (
                <li key={phase} className="text-sm">
                  <div className="flex justify-between"><span className="capitalize">{phase}</span><span>{n.toLocaleString()}</span></div>
                  <div className="mt-1 h-2 rounded bg-gray-800"><div className={`h-2 rounded ${phaseColor[phase] || "bg-gray-500"}`} style={{ width: `${tokenCap ? (n / tokenCap) * 100 : 0}%` }} /></div>
                </li>
              ))}
            </ul>
          ) : <p className="mt-1 text-sm text-gray-500">No per-phase token split available.</p>}
        </section>
      </div>

      {r.verdict ? (
        <section className="rounded border border-white/10 bg-white/[0.03] p-4">
          <h2 className="font-semibold">Verdict</h2>
          <p className="mt-1 text-sm leading-6 text-gray-200">{r.verdict}</p>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="font-semibold">Score breakdown — every score links to evidence</h2>
        {r.breakdown.length ? r.breakdown.map((d) => (<div key={d.dimension} className="flex justify-between rounded border border-gray-700 p-3"><span>{d.dimension} — {d.notes} <span className="text-xs text-gray-500">evidence: {d.evidence_event_ids.join(", ") || "—"}</span></span><strong>{d.score}</strong></div>)) : <p className="text-sm text-gray-500">No breakdown in this report.</p>}
      </section>

      <section><h2 className="mb-2 font-semibold">Session timeline (from the event log)</h2><EventTimeline events={r.timeline || []} /></section>
    </div>
  );
}

function DemoReport({ id }: { id: string }) {
  const r = demo;
  const totalPrompts = r.promptsByPhase.reduce((a, p) => a + p.count, 0);
  return (
    <div className="space-y-6">
      <p className="rounded border border-amber-500/70 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-200">
        Demo data — live report unavailable (attempt not submitted or backend offline). Everything below is sample data, not this attempt&apos;s report.
      </p>
      <div>
        <h1 className="text-2xl font-bold">Candidate Report — {id}</h1>
        <p className="text-sm text-[#E0A458]">{r.candidate} — layout + content modelled on HirePrise-style evidence cards. Live reports come from GET /attempts/{"{id}"}/report and /replay; every score below links to evidence event ids.</p>
        <Link className="mt-1 inline-block text-sm text-cobaltlt" href={`/attempts/${id}/replay`}>Watch session replay →</Link>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded border-2 border-vermillion/60 p-4 text-center"><p className="text-sm text-gray-400">Fit</p><p className="text-4xl font-bold text-cobaltlt">{r.fit}%</p><p className="mt-1 text-xs text-gray-500">weighted 40% functional + 60% AI collaboration</p></div>
        <div className="rounded border border-gray-700 p-4"><p className="text-sm text-gray-400">Functional</p><p className="text-3xl font-bold">{r.functional}</p><p className="text-xs text-gray-500">sample 50/50 · hidden 37.5/50</p></div>
        <div className="rounded border border-gray-700 p-4"><p className="text-sm text-gray-400">AI Collaboration</p><p className="text-3xl font-bold">{r.ai}</p><p className="text-xs text-gray-500">from recorded session events</p></div>
        <div className="rounded border border-gray-700 p-4"><p className="text-sm text-gray-400">Session</p><p className="text-sm">Active <strong>{r.metrics.activeTime}</strong></p><p className="text-sm">First edit <strong>{r.metrics.timeToFirstEdit}</strong></p><p className="text-sm">Sample green <strong>{r.metrics.sampleGreenAt}</strong></p><p className="text-xs text-gray-500">{r.metrics.prompts} prompts · {r.metrics.snapshots} git snapshots</p></div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded border border-sage/40 p-4">
          <h2 className="font-semibold text-sagelt">Hire signals</h2>
          <ul className="mt-2 space-y-3">{r.signals.map((s) => (<li key={s.text} className="text-sm"><p>{s.text}</p><a href={s.ref} className="font-mono text-xs text-cobaltlt underline">↳ {s.evidence}</a></li>))}</ul>
        </section>
        <section className="rounded border border-red-800/70 p-4">
          <h2 className="font-semibold text-red-300">Concerns</h2>
          <ul className="mt-2 space-y-3">{r.concerns.map((s) => (<li key={s.text} className="text-sm"><p>{s.text}</p><a href={s.ref} className="font-mono text-xs text-cobaltlt underline">↳ {s.evidence}</a></li>))}</ul>
        </section>
      </div>
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
      <section className="rounded border border-white/10 bg-white/[0.03] p-4">
        <h2 className="font-semibold">Reviewer summary</h2>
        <p className="mt-1 text-sm leading-6 text-gray-200">{r.summary}</p>
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold">AI collaboration breakdown — every score links to evidence</h2>
        {r.breakdown.map((d) => (<div key={d.dimension} className="flex justify-between rounded border border-gray-700 p-3"><span>{d.dimension} — {d.notes} <span className="text-xs text-gray-500">evidence: {d.evidence.join(", ")}</span></span><strong>{d.score}</strong></div>))}
      </section>
      <section><h2 className="mb-2 font-semibold">Session replay (from the event log)</h2><EventTimeline events={r.timeline} /></section>
    </div>
  );
}

export default function ReportPage({ params }: { params: { id: string } }) {
  const id = params.id;
  const [report, setReport] = useState<Report | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetchReport(id);
        if (!alive) return;
        setReport(r);
        const a = await fetchAttempt(id).catch(() => null);
        if (alive && a) setAttempt(a);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => { alive = false; };
  }, [id]);

  if (report) return <LiveReport id={id} r={report} attempt={attempt} />;
  if (failed) return <DemoReport id={id} />;
  return <p className="text-sm text-gray-400">Loading report…</p>;
}
