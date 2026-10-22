"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import EventTimeline from "@/components/EventTimeline";
import { fetchReplay } from "@/lib/api";
import type { Replay, SessionEvent } from "@/lib/types";

// Session replay: GET /attempts/{id}/replay returns the full ordered event
// log. Playback reveals events progressively — the delay between events is
// their real timestamp delta, capped at 2s (at 1x) so long thinking pauses
// don't stall the replay. A scrubber jumps by event index.

const phaseColor: Record<string, string> = { planning: "bg-cobalt", building: "bg-vermillion", debugging: "bg-stonewarm" };
const SPEEDS = [0.5, 1, 2, 4];

function payloadText(e: SessionEvent, keys: string[]): string {
  for (const k of keys) {
    const v = e.payload[k];
    if (typeof v === "string" && v) return v;
  }
  return "";
}

function EventRow({ e }: { e: SessionEvent }) {
  const seq = e.seq ?? e.sequence;
  const phase = String(e.payload.phase ?? "");
  if (e.type === "terminal_output") {
    return (
      <li className="rounded border border-gray-800 bg-gray-950 p-2.5">
        <p className="font-mono text-[11px] text-gray-500">#{seq} terminal output{e.ts ? ` · ${e.ts}` : ""}</p>
        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-xs text-gray-300">{payloadText(e, ["text", "output", "data"]) || JSON.stringify(e.payload)}</pre>
      </li>
    );
  }
  if (e.type === "terminal_cmd" || e.type === "terminal") {
    return (
      <li className="rounded border border-gray-800 bg-gray-900 p-2.5 font-mono text-xs text-gray-100">
        <span className="text-gray-500">#{seq} $</span> {payloadText(e, ["cmd", "command", "text"]) || JSON.stringify(e.payload)}
      </li>
    );
  }
  if (e.type === "prompt" || e.type === "agent_response") {
    const isPrompt = e.type === "prompt";
    return (
      <li className={`rounded border p-2.5 ${isPrompt ? "border-gray-700 bg-gray-900" : "border-gray-800 bg-gray-950"}`}>
        <p className="text-[11px] text-gray-500">
          {phase && phaseColor[phase] ? <span className={`mr-1 inline-block h-2 w-2 rounded-sm ${phaseColor[phase]}`} /> : null}
          #{seq} {isPrompt ? "Prompt" : "Agent response"}{phase ? ` · ${phase}` : ""}{e.ts ? ` · ${e.ts}` : ""}
        </p>
        <p className="mt-1 whitespace-pre-wrap text-sm text-gray-200">{payloadText(e, ["text", "response_text"]) || JSON.stringify(e.payload)}</p>
      </li>
    );
  }
  if (e.type === "file_edit" || e.type === "file_view") {
    return (
      <li className="rounded border border-gray-800 bg-gray-900 p-2.5 text-sm">
        <span className="font-mono text-xs text-gray-500">#{seq} {e.type}</span>{" "}
        <span className="font-mono text-xs text-gray-100">{payloadText(e, ["path", "file"]) || "—"}</span>
      </li>
    );
  }
  if (e.type === "git_snapshot") {
    return (
      <li className="rounded border border-gray-700 bg-white/[0.03] p-2.5 font-mono text-xs text-gray-300">
        ◆ #{seq} git snapshot {payloadText(e, ["snapshot_id", "commit_ref", "ref"])}{e.ts ? ` · ${e.ts}` : ""}
      </li>
    );
  }
  return (
    <li className="rounded border border-gray-800 bg-gray-900 p-2.5">
      <p className="font-mono text-[11px] text-gray-500">#{seq} {e.type}{e.ts ? ` · ${e.ts}` : ""}</p>
      <pre className="mt-1 overflow-auto text-xs text-gray-400">{JSON.stringify(e.payload, null, 2)}</pre>
    </li>
  );
}

export default function ReplayPage({ params }: { params: { id: string } }) {
  const id = params.id;
  const [replay, setReplay] = useState<Replay | null>(null);
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState(0); // number of events revealed
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetchReplay(id);
        if (alive) setReplay(r);
      } catch {
        if (alive) setError("Replay unavailable — the backend is offline or this attempt has no recorded session.");
      }
    })();
    return () => { alive = false; };
  }, [id]);

  const events = useMemo(() => {
    if (!replay) return [] as SessionEvent[];
    return [...replay.events].sort((a, b) => (a.seq ?? a.sequence) - (b.seq ?? b.sequence));
  }, [replay]);

  // Playback timer: schedule the next reveal from the ts delta (capped).
  useEffect(() => {
    if (!playing) return;
    if (cursor >= events.length) { setPlaying(false); return; }
    const prev = events[cursor - 1];
    const next = events[cursor];
    let deltaMs = 500;
    if (prev?.ts && next?.ts) {
      const d = new Date(next.ts).getTime() - new Date(prev.ts).getTime();
      if (Number.isFinite(d) && d > 0) deltaMs = Math.min(d, 2000);
    }
    timer.current = setTimeout(() => setCursor((c) => Math.min(events.length, c + 1)), deltaMs / speed);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [playing, cursor, events, speed]);

  if (error) return <div className="rounded border border-red-800/70 p-4 text-sm text-red-300">{error}</div>;
  if (!replay) return <p className="text-sm text-gray-400">Loading replay…</p>;

  const revealed = events.slice(0, cursor);
  const current = events[Math.max(0, cursor - 1)];
  const tb = replay.token_budget;
  const snapshots = replay.git_snapshots || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Session replay — attempt {id}</h1>
          <p className="text-sm text-gray-400">Status: {replay.status} · {events.length} recorded events{current?.ts ? <> · at <span className="font-mono">{current.ts}</span></> : null}</p>
        </div>
        <Link className="text-sm text-cobaltlt" href={`/reports/${id}`}>View evidence report →</Link>
      </div>

      {/* Playback controls */}
      <div className="flex flex-wrap items-center gap-3 rounded border border-gray-700 bg-gray-900/60 p-3">
        <button onClick={() => { if (cursor >= events.length) setCursor(0); setPlaying((p) => !p); }} className="rounded bg-vermilliondeep px-4 py-1.5 text-sm font-semibold text-white">
          {playing ? "Pause" : cursor >= events.length && events.length > 0 ? "Replay again" : "Play"}
        </button>
        <button onClick={() => { setPlaying(false); setCursor(0); }} className="rounded border border-gray-600 px-3 py-1.5 text-sm text-gray-200">Restart</button>
        <div className="flex items-center gap-1 text-xs text-gray-400">
          Speed
          {SPEEDS.map((s) => (
            <button key={s} onClick={() => setSpeed(s)} className={`rounded px-2 py-1 ${speed === s ? "bg-gray-700 text-white" : "text-gray-400"}`}>{s}×</button>
          ))}
        </div>
        <span className="font-mono text-xs text-gray-400">{cursor} / {events.length} events</span>
        <input
          type="range" min={0} max={events.length} value={cursor}
          onChange={(e) => setCursor(Number(e.target.value))}
          className="min-w-[200px] flex-1 accent-[#C53D0B]"
          aria-label="Scrub replay by event"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        {/* Stream */}
        <div className="space-y-3">
          {revealed.length === 0 ? (
            <p className="rounded border border-dashed border-gray-700 p-6 text-center text-sm text-gray-500">Press Play — events appear here in recorded order: terminal, prompts, file edits, snapshots.</p>
          ) : (
            <ul className="space-y-2">{revealed.map((e) => <EventRow key={e.id} e={e} />)}</ul>
          )}
          {revealed.length > 0 && (
            <details className="rounded border border-gray-800 p-3">
              <summary className="cursor-pointer text-sm text-gray-300">Raw event log (revealed so far)</summary>
              <div className="mt-2"><EventTimeline events={revealed} /></div>
            </details>
          )}
        </div>

        {/* Right rail */}
        <aside className="space-y-4">
          <section className="rounded border border-gray-700 p-4">
            <h2 className="font-semibold">Token budget</h2>
            {tb ? (
              <div className="mt-2 space-y-1 text-sm text-gray-300">
                <p>{tb.used.toLocaleString()} used of {tb.budget.toLocaleString()} · {tb.remaining.toLocaleString()} left</p>
                <div className="flex h-2.5 w-full overflow-hidden rounded bg-gray-800">
                  {Object.entries(tb.by_phase || {}).map(([p, n]) => (
                    <div key={p} className={phaseColor[p] || "bg-gray-500"} style={{ width: `${Math.min(100, (n / (tb.budget || 1)) * 100)}%` }} title={`${p}: ${n.toLocaleString()}`} />
                  ))}
                </div>
                {Object.entries(tb.by_phase || {}).map(([p, n]) => (
                  <p key={p} className="flex justify-between text-xs text-gray-400"><span className="capitalize">{p}</span><span>{n.toLocaleString()}</span></p>
                ))}
                {tb.hard_stop ? <p className="text-xs text-red-300">Budget hard stop was hit.</p> : tb.budget_exceeded ? <p className="text-xs text-[#E0A458]">Budget exceeded.</p> : null}
              </div>
            ) : <p className="mt-1 text-sm text-gray-500">No budget data in this replay.</p>}
          </section>
          <section className="rounded border border-gray-700 p-4">
            <h2 className="font-semibold">Git snapshots ({snapshots.length})</h2>
            {snapshots.length ? (
              <ul className="mt-2 space-y-1.5 font-mono text-xs text-gray-300">
                {snapshots.map((s, i) => (
                  <li key={i} className="rounded border border-gray-800 bg-gray-900 px-2 py-1.5">
                    {String(s.snapshot_id ?? s.id ?? `snapshot ${i + 1}`)}{s.commit_ref ? ` · ${String(s.commit_ref)}` : ""}{s.ts ? <span className="block text-gray-500">{String(s.ts)}</span> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-1 text-sm text-gray-500">No snapshots recorded.</p>}
          </section>
        </aside>
      </div>
    </div>
  );
}
