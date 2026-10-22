"use client";
import { useEffect, useRef, useState } from "react";
import { ApiError, agentChat, agentStatus, fetchEvents, fetchSession } from "@/lib/api";
import type { AgentStatus, SessionEvent, TokenBudget } from "@/lib/types";

// Side panel for the attempt workspace (POST /attempts/{id}/agent/chat).
// The mode is the CHALLENGE's recruiter-set agent_config.agent_mode —
// the panel only reads and reflects it (from the session payload); the
// candidate can never switch it, and the backend ignores mode claims.
// - mentor: the LangGraph mentor DIAGNOSES ONLY (SYMPTOM/WHERE/HINT),
//   never writes code, no file/command access.
// - agent: the LangGraph full agent may edit files and run commands in
//   the sandbox; its tool calls stream into the activity feed below and
//   are recorded as tool_call events with actor "agent".
// - History: recorded prompt / agent_response / mentor_guardrail /
//   tool_call events, merged with this session's local sends, deduped
//   by event id.
// - 403 = budget hard stop; 503 = panel not configured (no provider key).

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

const TOOL_ICON: Record<string, string> = { write_file: "✎", edit_file: "✎", run_command: "▶", read_file: "👁", list_files: "🗂" };

export default function AgentPanel({ attemptId, submitted, onBudget, onAgentActivity }: {
  attemptId: string;
  submitted: boolean;
  onBudget: (b: TokenBudget) => void;
  onAgentActivity?: () => void;
}) {
  const [phase, setPhase] = useState<(typeof PHASES)[number]>("building");
  const [mode, setMode] = useState<"mentor" | "agent">("mentor");
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
        const s = await fetchSession(attemptId);
        if (alive && s.agent_mode) setMode(s.agent_mode === "agent" ? "agent" : "mentor");
      } catch { /* mode defaults to mentor */ }
      try {
        const evts = await fetchEvents(attemptId, { types: ["prompt", "agent_response", "mentor_guardrail", "tool_call"] });
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
    // In agent mode the turn can take a while (a bounded tool loop);
    // poll the recorded tool_call events so actions appear in the feed
    // as they land, not only when the turn completes.
    let poll: ReturnType<typeof setInterval> | undefined;
    if (mode === "agent") {
      poll = setInterval(async () => {
        try {
          const evts = await fetchEvents(attemptId, { types: ["tool_call"] });
          setHistory((prev) => mergeEvents(evts, prev));
        } catch { /* feed is best-effort */ }
      }, 2500);
    }
    try {
      const r = await agentChat(attemptId, { prompt, phase, mode });
      if (r.agent_mode) setMode(r.agent_mode === "agent" ? "agent" : "mentor");
      const toolEvents = (r.tool_events ?? []) as SessionEvent[];
      setText("");
      onBudget(r.budget);
      if (toolEvents.length && onAgentActivity) onAgentActivity();
      // Re-sync from the server: its seq ordering interleaves the
      // prompt, tool_call and response events exactly as recorded.
      let synced = false;
      try {
        const evts = await fetchEvents(attemptId, { types: ["prompt", "agent_response", "mentor_guardrail", "tool_call"] });
        setHistory((prev) => mergeEvents(evts, prev.filter((e) => !e.id.startsWith("local-"))));
        synced = true;
      } catch { /* fall back to the local echo below */ }
      if (!synced) {
        const base = 1000000 + ++localSeq.current;
        const nowIso = new Date().toISOString();
        setHistory((prev) => mergeEvents(prev, [
          { id: `local-prompt-${base}`, attempt_id: attemptId, sequence: base, seq: base, ts: nowIso, actor: "candidate", type: "prompt", payload: { text: prompt, phase, mode } },
          ...toolEvents,
          { id: `local-response-${base}`, attempt_id: attemptId, sequence: base + 1, seq: base + 1, ts: nowIso, actor: "agent", type: "agent_response", payload: { text: r.response_text, phase, tokens_in: r.tokens_in, tokens_out: r.tokens_out, symptom: r.symptom ?? "", where: r.where ?? "", hint: r.hint ?? "" } },
        ]));
      }
    } catch (e) {
      const noun = mode === "agent" ? "agent" : "mentor";
      if (e instanceof ApiError && e.status === 403) {
        setError(`Token budget hard stop reached — the ${noun} is capped for this attempt. The editor and terminal still work; submit when ready.`);
      } else if (e instanceof ApiError && e.status === 503) {
        setError(`${mode === "agent" ? "Agent" : "Mentor"} not configured — add GROQ_API_KEY to the backend .env and restart; the terminal and editor still work.`);
        setStatus((s) => s ? { ...s, configured: false } : { configured: false, provider: "", model: "" });
      } else {
        setError(`${mode === "agent" ? "Agent" : "Mentor"} request failed — the backend may be offline. Your message was not sent.`);
      }
    } finally { if (poll) clearInterval(poll); setSending(false); }
  }

  const notConfigured = statusLoaded && (!status || !status.configured);
  const isAgent = mode === "agent";

  return (
    <section className="space-y-3 rounded border border-gray-700 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{isAgent ? "AI Agent" : "Mentor"}</h2>
        <span className="flex items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${isAgent ? "bg-vermillion text-white" : "bg-gray-800 text-gray-400"}`}>
            {isAgent ? "Full agent · recruiter enabled" : "Mentor · recruiter set"}
          </span>
          {status?.configured ? <span className="text-[11px] text-gray-500">{status.provider} · {status.model}</span> : null}
        </span>
      </div>
      {isAgent ? (
        <p className="text-xs text-gray-500">
          This challenge&apos;s recruiter enabled the <strong className="text-gray-300">full agent</strong>: it can <strong className="text-gray-300">edit your files and run commands</strong> in the sandbox to help you. Every action it takes is recorded and attributed to the agent in your report.
        </p>
      ) : (
        <p className="text-xs text-gray-500">
          I can explain <strong className="text-gray-300">what&apos;s wrong</strong> and point you at <strong className="text-gray-300">what to check</strong> — I won&apos;t write code for you, and I can&apos;t edit your files. Every exchange is recorded.
        </p>
      )}

      {notConfigured ? (
        <p className="rounded border border-gray-700 bg-gray-900 p-3 text-sm text-gray-300">
          {isAgent ? "Agent" : "Mentor"} not configured — add GROQ_API_KEY to the backend .env and restart; the terminal and editor still work.
        </p>
      ) : null}

      <ul className="space-y-2">
        {history.length === 0 && <li className="text-sm text-gray-500">No {isAgent ? "agent" : "mentor"} exchanges recorded yet for this attempt.</li>}
        {history.map((e) => {
          const p = e.payload;
          const ph = String(p.phase ?? "");
          if (e.type === "tool_call") {
            const tool = String(p.tool ?? "");
            const refused = p.ok === false;
            return (
              <li key={e.id} className={`rounded border px-2.5 py-1.5 font-mono text-xs ${refused ? "border-red-800/70 bg-red-950/30 text-red-200" : "border-gray-800 bg-gray-900 text-gray-300"}`}>
                <span className="mr-1.5">{TOOL_ICON[tool] ?? "•"}</span>{String(p.summary ?? tool)}
                <span className="ml-1.5 text-[10px] uppercase tracking-wide text-gray-500">agent</span>
              </li>
            );
          }
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
                {e.type === "agent_response" ? (isAgent ? "agent" : "mentor") : e.type}{ph ? ` · ${ph}` : ""}{tokens} · <span className="font-mono">{e.id.startsWith("local-") ? "this session" : e.id}</span>
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
          placeholder={submitted ? `Attempt submitted — the ${isAgent ? "agent" : "mentor"} panel is closed.` : isAgent ? "Tell the agent what to work on — it can inspect and edit files and run commands; everything is recorded." : "Describe what you're seeing — the mentor will diagnose it, not solve it."}
          className="w-full rounded border border-gray-600 bg-gray-900 p-2.5 text-sm text-gray-100 placeholder:text-gray-500 disabled:opacity-50"
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }}
        />
        <button onClick={send} disabled={notConfigured || submitted || sending || !text.trim()} className="rounded bg-vermilliondeep px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {sending ? (isAgent ? "Working…" : "Asking…") : (isAgent ? "Send to agent" : "Ask the mentor")}
        </button>
        <p className="text-[11px] text-gray-600">Ctrl/Cmd+Enter to send.</p>
      </div>
    </section>
  );
}
