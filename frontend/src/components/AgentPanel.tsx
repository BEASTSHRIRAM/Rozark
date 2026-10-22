"use client";
import { useEffect, useRef, useState } from "react";
import { ApiError, agentChat, agentStatus, fetchEvents } from "@/lib/api";
import type { AgentStatus, SessionEvent, TokenBudget } from "@/lib/types";

// Mentor panel for the attempt workspace (LangGraph mentor graph behind
// POST /attempts/{id}/agent/chat).
// - The mentor DIAGNOSES ONLY: it explains what is wrong and points at
//   what to check. It never writes or fixes code, and has no file or
//   command access — there is no Plan/Agent mode any more.
// - Replies render as SYMPTOM / WHERE / HINT sections (sections come from
//   the response/payload; older unstructured replies render as-is).
// - History: recorded prompt / agent_response / mentor_guardrail events,
//   merged with this session's local sends, deduped by event id.
// - 403 = budget hard stop; 503 = mentor not configured (no provider key).

const phaseColor: Record<string, string> = { planning: "bg-cobalt", building: "bg-vermillion", debugging: "bg-stonewarm" };
const PHASES = ["planning", "building", "debugging"] as const;

interface Sections { symptom: string; where: string; hint: string }

function sectionsFromText(text: string): Sections | null {
  const m = text.match(/SYMPTOM:\s*([\s\S]*?)(?:\n\s*WHERE:\s*([\s\S]*?))?(?:\n\s*HINT:\s*([\s\S]*))?$/i);
  if (!m || !/^\s*SYMPTOM:/i.test(text)) return null;
  return { symptom: (m[1] || "").trim(), where: (m[2] || "").trim(), hint: (m[3] || "").trim() };
}

function sectionsOf(e: SessionEvent, fallbackText: string): Sections | null {
  const p = e.payload;
  if (typeof p.symptom === "string" && (p.symptom || p.where || p.hint)) {
    return { symptom: p.symptom, where: String(p.where ?? ""), hint: String(p.hint ?? "") };
  }
  return sectionsFromText(fallbackText);
}

function SectionBlock({ sections }: { sections: Sections }) {
  const rows: [string, string][] = [
    ["Symptom", sections.symptom],
    ["Where", sections.where],
    ["Hint", sections.hint],
  ];
  return (
    <div className="mt-1 space-y-1.5">
      {rows.filter(([, v]) => v).map(([label, v]) => (
        <p key={label} className="text-sm text-gray-200">
          <span className="mr-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</span>
          <span className="whitespace-pre-wrap">{v}</span>
        </p>
      ))}
    </div>
  );
}

export default function AgentPanel({ attemptId, submitted, onBudget }: {
  attemptId: string;
  submitted: boolean;
  onBudget: (b: TokenBudget) => void;
}) {
  const [phase, setPhase] = useState<(typeof PHASES)[number]>("building");
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [history, setHistory] = useState<SessionEvent[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const localSeq = useRef(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try { const s = await agentStatus(); if (alive) setStatus(s); }
      catch { if (alive) setStatus(null); }
      finally { if (alive) setStatusLoaded(true); }
      try {
        const evts = await fetchEvents(attemptId, { types: ["prompt", "agent_response", "mentor_guardrail"] });
        if (alive) setHistory((prev) => mergeEvents(evts, prev));
      } catch { /* history is best-effort */ }
    })();
    return () => { alive = false; };
  }, [attemptId]);

  function mergeEvents(server: SessionEvent[], local: SessionEvent[]): SessionEvent[] {
    const byId = new Map<string, SessionEvent>();
    for (const e of [...server, ...local]) if (!byId.has(e.id)) byId.set(e.id, e);
    return Array.from(byId.values()).sort((a, b) => (a.seq ?? a.sequence) - (b.seq ?? b.sequence));
  }

  async function send() {
    const prompt = text.trim();
    if (!prompt || sending) return;
    setSending(true); setError("");
    try {
      const r = await agentChat(attemptId, { prompt, phase, mode: "mentor" });
      const base = 1000000 + ++localSeq.current;
      const nowIso = new Date().toISOString();
      setHistory((prev) => mergeEvents(prev, [
        { id: `local-prompt-${base}`, attempt_id: attemptId, sequence: base, seq: base, ts: nowIso, actor: "candidate", type: "prompt", payload: { text: prompt, phase, mode: "mentor" } },
        { id: `local-response-${base}`, attempt_id: attemptId, sequence: base + 1, seq: base + 1, ts: nowIso, actor: "agent", type: "agent_response", payload: { text: r.response_text, phase, tokens_in: r.tokens_in, tokens_out: r.tokens_out, symptom: r.symptom ?? "", where: r.where ?? "", hint: r.hint ?? "" } },
      ]));
      setText("");
      onBudget(r.budget);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setError("Token budget hard stop reached — the mentor is capped for this attempt. The editor and terminal still work; submit when ready.");
      } else if (e instanceof ApiError && e.status === 503) {
        setError("Mentor not configured — add GROQ_API_KEY to the backend .env and restart; the terminal and editor still work.");
        setStatus((s) => s ? { ...s, configured: false } : { configured: false, provider: "", model: "" });
      } else {
        setError("Mentor request failed — the backend may be offline. Your message was not sent.");
      }
    } finally { setSending(false); }
  }

  const notConfigured = statusLoaded && (!status || !status.configured);

  return (
    <section className="space-y-3 rounded border border-gray-700 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Mentor</h2>
        {status?.configured ? <span className="text-[11px] text-gray-500">{status.provider} · {status.model}</span> : null}
      </div>
      <p className="text-xs text-gray-500">
        I can explain <strong className="text-gray-300">what&apos;s wrong</strong> and point you at <strong className="text-gray-300">what to check</strong> — I won&apos;t write code for you, and I can&apos;t edit your files. Every exchange is recorded.
      </p>

      {notConfigured ? (
        <p className="rounded border border-gray-700 bg-gray-900 p-3 text-sm text-gray-300">
          Mentor not configured — add GROQ_API_KEY to the backend .env and restart; the terminal and editor still work.
        </p>
      ) : null}

      <ul className="space-y-2">
        {history.length === 0 && <li className="text-sm text-gray-500">No mentor exchanges recorded yet for this attempt.</li>}
        {history.map((e) => {
          const p = e.payload;
          const ph = String(p.phase ?? "");
          if (e.type === "mentor_guardrail") {
            return (
              <li key={e.id} className="rounded border border-stonewarm/50 bg-gray-900 px-2.5 py-1.5 text-[11px] text-gray-400">
                🛡 Mentor guardrail {String(p.action ?? "intervened")} — a draft that crossed into solution territory was {String(p.action ?? "") === "blocked" ? "blocked" : "rewritten"} before it reached you.
              </li>
            );
          }
          const body = String(p.text ?? p.response_text ?? "");
          const tokens = typeof p.tokens_in === "number" || typeof p.tokens_out === "number"
            ? ` · ${Number(p.tokens_in ?? 0).toLocaleString()} in / ${Number(p.tokens_out ?? 0).toLocaleString()} out tokens` : "";
          const sections = e.type === "agent_response" ? sectionsOf(e, body) : null;
          return (
            <li key={e.id} className="rounded border border-gray-800 bg-gray-900 p-2.5">
              <p className="text-[11px] text-gray-500">
                {ph && phaseColor[ph] ? <span className={`mr-1 inline-block h-2 w-2 rounded-sm ${phaseColor[ph]}`} /> : null}
                {e.type === "agent_response" ? "mentor" : e.type}{ph ? ` · ${ph}` : ""}{tokens} · <span className="font-mono">{e.id.startsWith("local-") ? "this session" : e.id}</span>
              </p>
              {sections ? <SectionBlock sections={sections} /> : body ? <p className="mt-1 whitespace-pre-wrap text-sm text-gray-200">{body}</p> : null}
            </li>
          );
        })}
      </ul>

      {error && <p className="rounded border border-red-800/70 px-3 py-2 text-xs text-red-300">{error}</p>}

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <label htmlFor="mentor-phase">Phase</label>
          <select id="mentor-phase" value={phase} onChange={(e) => setPhase(e.target.value as (typeof PHASES)[number])} disabled={notConfigured || submitted} className="rounded border border-gray-600 bg-gray-900 px-2 py-1 text-gray-200">
            {PHASES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <span className={`inline-block h-2 w-2 rounded-sm ${phaseColor[phase]}`} />
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={notConfigured || submitted}
          rows={3}
          placeholder={submitted ? "Attempt submitted — the mentor panel is closed." : "Describe what you're seeing — the mentor will diagnose it, not solve it."}
          className="w-full rounded border border-gray-600 bg-gray-900 p-2.5 text-sm text-gray-100 placeholder:text-gray-500 disabled:opacity-50"
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }}
        />
        <button onClick={send} disabled={notConfigured || submitted || sending || !text.trim()} className="rounded bg-vermilliondeep px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {sending ? "Asking…" : "Ask the mentor"}
        </button>
        <p className="text-[11px] text-gray-600">Ctrl/Cmd+Enter to send.</p>
      </div>
    </section>
  );
}
