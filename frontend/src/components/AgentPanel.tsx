"use client";
import { useEffect, useRef, useState } from "react";
import { ApiError, agentChat, agentStatus, fetchEvents } from "@/lib/api";
import type { AgentStatus, SessionEvent, TokenBudget } from "@/lib/types";

// Live AI agent panel for the attempt workspace.
// - On mount: GET /agent/status. If the backend has no agent key, the panel
//   says so plainly and the composer is disabled (editor/terminal still work).
// - History: recorded prompt / agent_response / tool_call events from the
//   event log, merged with this session's local sends, deduped by event id.
// - Send: POST /attempts/{id}/agent/chat {prompt, phase, mode}; the reply is
//   appended with its token counts and the page budget bar refreshes from
//   the returned budget. 403 = budget hard stop; 503 = agent not configured.

const phaseColor: Record<string, string> = { planning: "bg-cobalt", building: "bg-vermillion", debugging: "bg-stonewarm" };
const PHASES = ["planning", "building", "debugging"] as const;

export default function AgentPanel({ attemptId, submitted, onBudget }: {
  attemptId: string;
  submitted: boolean;
  onBudget: (b: TokenBudget) => void;
}) {
  const [mode, setMode] = useState<"plan" | "agent">("agent");
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
        const evts = await fetchEvents(attemptId, { types: ["prompt", "agent_response", "tool_call"] });
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
      const r = await agentChat(attemptId, { prompt, phase, mode });
      const base = 1000000 + ++localSeq.current;
      const nowIso = new Date().toISOString();
      setHistory((prev) => mergeEvents(prev, [
        { id: `local-prompt-${base}`, attempt_id: attemptId, sequence: base, seq: base, ts: nowIso, actor: "candidate", type: "prompt", payload: { text: prompt, phase, mode } },
        { id: `local-response-${base}`, attempt_id: attemptId, sequence: base + 1, seq: base + 1, ts: nowIso, actor: "agent", type: "agent_response", payload: { text: r.response_text, phase, tokens_in: r.tokens_in, tokens_out: r.tokens_out } },
      ]));
      setText("");
      onBudget(r.budget);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setError("Token budget hard stop reached — the agent is capped for this attempt. The editor and terminal still work; submit when ready.");
      } else if (e instanceof ApiError && e.status === 503) {
        setError("AI agent not configured — add GROQ_API_KEY to the backend .env and restart; prompts are unavailable but the terminal and editor still work.");
        setStatus((s) => s ? { ...s, configured: false } : { configured: false, provider: "", model: "" });
      } else {
        setError("Agent request failed — the backend may be offline. Your prompt was not sent.");
      }
    } finally { setSending(false); }
  }

  const notConfigured = statusLoaded && (!status || !status.configured);

  return (
    <section className="space-y-3 rounded border border-gray-700 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">AI Agent</h2>
        <div className="flex rounded border border-gray-600 text-xs" role="group" aria-label="Agent mode">
          {(["plan", "agent"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={`px-3 py-1 capitalize ${mode === m ? "bg-vermillion text-white" : "text-gray-400"}`}>{m}</button>
          ))}
        </div>
      </div>
      <p className="text-xs text-gray-500">
        Mode: <strong className="text-gray-300 capitalize">{mode}</strong> — {mode === "plan" ? "agent proposes, candidate approves before edits." : "agent may edit and run tools directly."}
        {status?.configured ? <span className="block pt-1 text-gray-500">{status.provider} · {status.model}</span> : null}
      </p>

      {notConfigured ? (
        <p className="rounded border border-gray-700 bg-gray-900 p-3 text-sm text-gray-300">
          AI agent not configured — add GROQ_API_KEY to the backend .env and restart; prompts are unavailable but the terminal and editor still work.
        </p>
      ) : null}

      <ul className="space-y-2">
        {history.length === 0 && <li className="text-sm text-gray-500">No prompts recorded yet for this attempt.</li>}
        {history.map((e) => {
          const p = e.payload;
          const body = String(p.text ?? p.response_text ?? p.tool ?? p.name ?? "");
          const ph = String(p.phase ?? "");
          const tokens = typeof p.tokens_in === "number" || typeof p.tokens_out === "number"
            ? ` · ${Number(p.tokens_in ?? 0).toLocaleString()} in / ${Number(p.tokens_out ?? 0).toLocaleString()} out tokens` : "";
          return (
            <li key={e.id} className="rounded border border-gray-800 bg-gray-900 p-2.5">
              <p className="text-[11px] text-gray-500">
                {ph && phaseColor[ph] ? <span className={`mr-1 inline-block h-2 w-2 rounded-sm ${phaseColor[ph]}`} /> : null}
                {e.type}{ph ? ` · ${ph}` : ""}{tokens} · <span className="font-mono">{e.id.startsWith("local-") ? "this session" : e.id}</span>
              </p>
              {body ? <p className="mt-1 whitespace-pre-wrap text-sm text-gray-200">{body}</p> : <pre className="mt-1 overflow-auto text-xs text-gray-400">{JSON.stringify(p, null, 2)}</pre>}
            </li>
          );
        })}
      </ul>

      {error && <p className="rounded border border-red-800/70 px-3 py-2 text-xs text-red-300">{error}</p>}

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <label htmlFor="agent-phase">Phase</label>
          <select id="agent-phase" value={phase} onChange={(e) => setPhase(e.target.value as (typeof PHASES)[number])} disabled={notConfigured || submitted} className="rounded border border-gray-600 bg-gray-900 px-2 py-1 text-gray-200">
            {PHASES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <span className={`inline-block h-2 w-2 rounded-sm ${phaseColor[phase]}`} />
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={notConfigured || submitted}
          rows={3}
          placeholder={submitted ? "Attempt submitted — the agent panel is closed." : "Ask the agent… every prompt is recorded as a phase-tagged event."}
          className="w-full rounded border border-gray-600 bg-gray-900 p-2.5 text-sm text-gray-100 placeholder:text-gray-500 disabled:opacity-50"
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }}
        />
        <button onClick={send} disabled={notConfigured || submitted || sending || !text.trim()} className="rounded bg-vermilliondeep px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {sending ? "Sending…" : "Send prompt"}
        </button>
        <p className="text-[11px] text-gray-600">Ctrl/Cmd+Enter to send.</p>
      </div>
    </section>
  );
}
