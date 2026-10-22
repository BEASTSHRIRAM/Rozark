"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SandboxTerminal from "@/components/SandboxTerminal";
import CodeEditor from "@/components/CodeEditor";
import AgentPanel from "@/components/AgentPanel";
import PublicTestsPanel from "@/components/PublicTestsPanel";
import { ApiError, fetchAttempt, fetchBudget, fetchChallenge, fetchSession, heartbeat, listFiles, readFile, runScore, startSandbox, submitAttempt, writeFile } from "@/lib/api";
import type { Attempt, Challenge, SessionStatus, TokenBudget, WorkspaceFile } from "@/lib/types";

// ---------------------------------------------------------------------------
// Attempt workspace — 3-pane layout, LIVE data.
// Brief LEFT (real challenge) · Code MIDDLE (files API + Monaco editor,
// terminal below is the live websocket PTY) · Mentor + Tests RIGHT
// (mentor: components/AgentPanel.tsx — diagnose-only, SYMPTOM/WHERE/HINT;
// tests: components/PublicTestsPanel.tsx — named public tests, hidden
// tests as a locked count).
// Header countdown comes from GET /attempts/{id}/session (polled 15s,
// heartbeat POST every 30s); the budget bar from GET /attempts/{id}/budget
// (polled 10s). Submit runs scoring (best-effort) then POST /submit.
// ---------------------------------------------------------------------------

const phaseColor: Record<string, string> = { planning: "bg-cobalt", building: "bg-vermillion", debugging: "bg-stonewarm" };

interface OpenFile { path: string; content: string; saved: string; readOnly: boolean; }

function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

function BudgetBar({ budget }: { budget: TokenBudget | null }) {
  if (!budget) return <p className="text-xs text-gray-500">Token budget loading…</p>;
  const cap = budget.budget || 1;
  const pct = (n: number) => `${Math.min(100, (n / cap) * 100).toFixed(1)}%`;
  const phases = Object.keys(budget.by_phase).length ? budget.by_phase : { planning: 0, building: 0, debugging: 0 };
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-400">
        <span>Token budget{budget.hard_stop ? " — HARD STOP" : budget.budget_exceeded ? " — exceeded" : ""}</span>
        <span>{budget.used.toLocaleString()} / {budget.budget.toLocaleString()} · {budget.remaining.toLocaleString()} left</span>
      </div>
      <div className="mt-1 flex h-2.5 w-full overflow-hidden rounded bg-gray-800" title="Tokens by phase">
        {Object.entries(phases).map(([p, n]) => (
          <div key={p} className={phaseColor[p] || "bg-gray-500"} style={{ width: pct(n) }} title={`${p}: ${n.toLocaleString()}`} />
        ))}
      </div>
      <div className="mt-1 flex gap-3 text-[11px] text-gray-500">
        {Object.entries(phases).map(([p, n]) => (
          <span key={p}><span className={`mr-1 inline-block h-2 w-2 rounded-sm ${phaseColor[p] || "bg-gray-500"}`} />{p} {n.toLocaleString()}</span>
        ))}
      </div>
    </div>
  );
}

export default function AttemptPage({ params }: { params: { id: string } }) {
  const id = params.id;
  const router = useRouter();
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [loadError, setLoadError] = useState("");
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [budget, setBudget] = useState<TokenBudget | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [noWorkspace, setNoWorkspace] = useState(false);
  const [filesError, setFilesError] = useState("");
  const [startingWs, setStartingWs] = useState(false);
  const [tabs, setTabs] = useState<OpenFile[]>([]);
  const [activePath, setActivePath] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const openedDefaults = useRef(false);

  const submitted = attempt?.status === "submitted";
  const active = tabs.find((t) => t.path === activePath) || null;

  // --- initial load: attempt + challenge ---------------------------------
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const a = await fetchAttempt(id);
        if (!alive) return;
        setAttempt(a);
        const c = await fetchChallenge(a.challenge_id).catch(() => null);
        if (alive && c) setChallenge(c);
      } catch {
        if (alive) setLoadError("Could not load this attempt — it may not exist, or the backend is offline (:8000).");
      }
    })();
    return () => { alive = false; };
  }, [id]);

  // --- session poll (15s) + heartbeat (30s) + 1s clock --------------------
  useEffect(() => {
    let alive = true;
    const poll = async () => { try { const s = await fetchSession(id); if (alive) setSession(s); } catch { /* keep last */ } };
    poll();
    const iv = setInterval(poll, 15000);
    const hb = setInterval(async () => { try { const s = await heartbeat(id); if (alive) setSession(s); } catch { /* best-effort */ } }, 30000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { alive = false; clearInterval(iv); clearInterval(hb); clearInterval(tick); };
  }, [id]);

  // --- budget poll (10s) ---------------------------------------------------
  useEffect(() => {
    let alive = true;
    const poll = async () => { try { const b = await fetchBudget(id); if (alive) setBudget(b); } catch { /* keep last */ } };
    poll();
    const iv = setInterval(poll, 10000);
    return () => { alive = false; clearInterval(iv); };
  }, [id]);

  // --- workspace files -------------------------------------------------------
  const loadFiles = useCallback(async () => {
    try {
      const list = await listFiles(id);
      setFiles(list.files);
      setNoWorkspace(false);
      setFilesError("");
      return list.files;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) { setNoWorkspace(true); return null; }
      setFilesError("Could not list workspace files — backend offline?");
      return null;
    }
  }, [id]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  const openFile = useCallback(async (path: string) => {
    setActivePath(path);
    if (tabs.some((t) => t.path === path)) return;
    try {
      const f = await readFile(id, path);
      setTabs((prev) => prev.some((t) => t.path === path) ? prev : [...prev, { path, content: f.content, saved: f.content, readOnly: f.read_only }]);
    } catch {
      setSaveMsg(`Could not open ${path}.`);
    }
  }, [id, tabs]);

  // Open the challenge's default files once the file list arrives.
  useEffect(() => {
    if (openedDefaults.current || !challenge || !files.length) return;
    openedDefaults.current = true;
    const defaults = (challenge.ide_setup?.default_open_files || []).filter((p) => files.some((f) => f.path === p));
    const toOpen = defaults.length ? defaults : files.filter((f) => !f.hidden).slice(0, 1).map((f) => f.path);
    (async () => { for (const p of toOpen) await openFile(p); })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge, files]);

  async function startWorkspace() {
    setStartingWs(true);
    try {
      await startSandbox(id);
      await loadFiles();
    } catch {
      setFilesError("Sandbox start failed — is the backend running on :8000?");
    } finally { setStartingWs(false); }
  }

  async function saveActive() {
    if (!active || active.readOnly || submitted) return;
    setSaving(true); setSaveMsg("");
    try {
      await writeFile(id, active.path, active.content);
      setTabs((prev) => prev.map((t) => t.path === active.path ? { ...t, saved: t.content } : t));
      setSaveMsg(`Saved ${active.path}`);
    } catch (e) {
      setSaveMsg(e instanceof ApiError && e.status === 403 ? `${active.path} is read-only — save blocked by the backend.` : `Save failed for ${active.path}.`);
    } finally { setSaving(false); }
  }

  function closeTab(path: string) {
    setTabs((prev) => {
      const next = prev.filter((t) => t.path !== path);
      if (activePath === path) setActivePath(next.length ? next[next.length - 1].path : "");
      return next;
    });
  }

  async function onSubmit() {
    if (!window.confirm("Submit this attempt? Scoring runs first, then the workspace is frozen and the report is generated.")) return;
    setSubmitting(true); setSubmitError("");
    try { await runScore(id); } catch { /* scoring is best-effort before submit */ }
    try {
      await submitAttempt(id);
      router.push(`/attempts/${id}/submitted`);
    } catch {
      setSubmitError("Submit failed — the backend rejected it or is offline. Your workspace is unchanged.");
      setSubmitting(false);
    }
  }

  const remaining = session?.expires_at ? Math.max(0, (new Date(session.expires_at).getTime() - now) / 1000) : session ? session.remaining_seconds : null;
  const elapsedPct = session?.time_limit_minutes && remaining !== null ? Math.min(100, Math.max(0, (1 - remaining / (session.time_limit_minutes * 60)) * 100)) : 0;

  if (loadError) {
    return <div className="rounded border border-red-800/70 p-4 text-sm text-red-300">{loadError}</div>;
  }
  if (!attempt) return <p className="text-sm text-gray-400">Loading attempt…</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">{challenge?.title || "Attempt"} <span className="text-sm font-normal text-gray-500">— {attempt.candidate_name} · attempt {id}</span></h1>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="font-mono text-lg leading-none">{remaining !== null ? fmtClock(remaining) : "--:--"} <span className="text-xs text-gray-500">left{session?.time_limit_minutes ? ` of ${session.time_limit_minutes}m` : ""}</span></p>
            <div className="mt-1 h-1.5 w-40 rounded bg-gray-800"><div className="h-1.5 rounded bg-vermillion" style={{ width: `${elapsedPct}%` }} /></div>
          </div>
          {!submitted && (
            <button onClick={onSubmit} disabled={submitting} className="rounded bg-sage px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {submitting ? "Submitting…" : "Submit"}
            </button>
          )}
        </div>
      </div>
      {submitError && <p className="rounded border border-red-800/70 px-3 py-2 text-xs text-red-300">{submitError}</p>}
      {submitted && (
        <p className="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200">
          This attempt is <strong>submitted</strong> — the workspace is frozen and read-only.
        </p>
      )}
      <div className="w-full max-w-md"><BudgetBar budget={budget} /></div>

      <div className="grid gap-4 xl:grid-cols-[300px_1fr_340px]">
        {/* LEFT — brief (real challenge data) */}
        <section className="space-y-4 rounded border border-gray-700 p-4">
          <div>
            <h2 className="font-semibold">Brief</h2>
            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-300">{challenge?.problem_description || "Loading challenge…"}</p>
            {challenge?.software_instructions ? <p className="mt-2 whitespace-pre-wrap text-sm text-gray-400">{challenge.software_instructions}</p> : null}
          </div>
          {challenge && (
            <>
              <div className="flex flex-wrap gap-1.5 text-[11px] text-gray-400">
                <span className="rounded bg-gray-800 px-2 py-0.5">{challenge.type}</span>
                <span className="rounded bg-gray-800 px-2 py-0.5">{challenge.difficulty}</span>
                <span className="rounded bg-gray-800 px-2 py-0.5">{challenge.score} pts</span>
                {challenge.tags.map((t) => <span key={t} className="rounded bg-gray-800 px-2 py-0.5">{t}</span>)}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-200">Workspace commands</h3>
                <dl className="mt-1 space-y-1 font-mono text-xs text-gray-400">
                  <div><dt className="text-gray-500">install</dt><dd className="break-all">{challenge.ide_setup.install_command || "—"}</dd></div>
                  <div><dt className="text-gray-500">run</dt><dd className="break-all">{challenge.ide_setup.run_command || "—"}</dd></div>
                  <div><dt className="text-gray-500">test</dt><dd className="break-all">{challenge.ide_setup.test_command || "—"}</dd></div>
                </dl>
              </div>
              <div className="rounded border border-gray-800 bg-gray-900 p-3">
                <h3 className="text-sm font-semibold">Scoring</h3>
                <ul className="mt-1 space-y-1 text-xs text-gray-400">
                  <li>Mode: {challenge.scoring?.mode || "automated"}{challenge.scoring?.format ? ` · ${challenge.scoring.format}` : ""}</li>
                  <li>Functional {(challenge.rubric_weights.functional * 100).toFixed(0)}% · AI collaboration {(challenge.rubric_weights.ai_collaboration * 100).toFixed(0)}%</li>
                  <li>Token budget {challenge.agent_config.token_budget.toLocaleString()} · agents: {challenge.agent_config.allowed_agents.join(", ") || "—"}</li>
                  {challenge.ide_setup.read_only_files.length ? <li>Read-only: <span className="font-mono">{challenge.ide_setup.read_only_files.join(", ")}</span></li> : null}
                  {challenge.ide_setup.hidden_files.length ? <li>Hidden files are never shown; the hidden suite runs at submit.</li> : null}
                </ul>
              </div>
            </>
          )}
        </section>

        {/* MIDDLE — files + editor + live terminal */}
        <section className="overflow-hidden rounded border border-gray-700">
          {noWorkspace ? (
            <div className="space-y-3 p-6">
              <p className="font-semibold">No workspace yet</p>
              <p className="text-sm text-gray-400">Start the sandbox to load the workspace — an isolated copy of the challenge project is created for this attempt, and the editor + terminal work in it.</p>
              <button onClick={startWorkspace} disabled={startingWs} className="rounded bg-vermilliondeep px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{startingWs ? "Starting…" : "Start sandbox to load the workspace"}</button>
              {filesError && <p className="text-xs text-red-300">{filesError}</p>}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center border-b border-gray-700 bg-gray-900 text-xs">
                {tabs.map((t) => (
                  <span key={t.path} className={`flex items-center gap-2 border-r border-gray-700 px-3 py-2 font-mono ${t.path === activePath ? "bg-gray-950 text-gray-100" : "text-gray-500"}`}>
                    <button onClick={() => setActivePath(t.path)}>{t.path}{t.content !== t.saved ? " ●" : ""}</button>
                    {t.readOnly && <span className="rounded bg-gray-800 px-1 text-[10px] text-gray-400">read-only</span>}
                    <button aria-label={`Close ${t.path}`} onClick={() => closeTab(t.path)} className="text-gray-600 hover:text-gray-300">×</button>
                  </span>
                ))}
                <span className="ml-auto flex items-center gap-2 px-3 py-1.5">
                  {saveMsg && <span className="text-[11px] text-gray-400">{saveMsg}</span>}
                  <button onClick={saveActive} disabled={!active || active.readOnly || submitted || saving || active.content === active.saved} className="rounded border border-gray-600 px-2.5 py-1 text-[11px] text-gray-200 disabled:opacity-40">{saving ? "Saving…" : "Save"}</button>
                </span>
              </div>
              <div className="grid grid-cols-[180px_1fr]">
                <aside className="border-r border-gray-800 bg-gray-900/60 p-2">
                  <p className="px-1 text-[11px] uppercase tracking-wide text-gray-500">Explorer</p>
                  <ul className="mt-1 space-y-0.5 font-mono text-xs">
                    {files.filter((f) => !f.hidden).map((f) => (
                      <li key={f.path}>
                        <button onClick={() => openFile(f.path)} className={`w-full rounded px-1 py-0.5 text-left ${f.path === activePath ? "bg-gray-800 text-gray-100" : "text-gray-400"}`}>
                          {f.path}{f.read_only ? <span className="ml-1 text-[10px] text-gray-600">ro</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {filesError && <p className="mt-2 px-1 text-[11px] text-red-300">{filesError}</p>}
                </aside>
                <div className="min-h-[320px]">
                  {active ? (
                    <CodeEditor
                      path={active.path}
                      value={active.content}
                      readOnly={active.readOnly || !!submitted}
                      onChange={(v) => setTabs((prev) => prev.map((t) => t.path === active.path ? { ...t, content: v } : t))}
                      onSave={saveActive}
                    />
                  ) : (
                    <p className="p-4 font-mono text-xs text-gray-500">Select a file from the explorer to edit it.</p>
                  )}
                </div>
              </div>
            </>
          )}
          <div className="border-t border-gray-700 bg-gray-900/60 p-3">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Sandbox terminal — live</p>
            <SandboxTerminal attemptId={id} submitted={!!submitted} />
          </div>
          <div className="flex justify-between border-t border-gray-700 bg-white/[0.02] px-3 py-1 text-[11px] text-gray-300">
            <span>rozark-sandbox</span><span>recorded ●</span>
          </div>
        </section>

        {/* RIGHT — mentor panel (diagnose-only) + public tests checklist */}
        <div className="space-y-4">
          <AgentPanel attemptId={id} submitted={!!submitted} onBudget={setBudget} />
          <PublicTestsPanel attemptId={id} />
        </div>
      </div>

      {/* No footer links here on purpose: the evidence report and session
          replay are RECRUITER review surfaces. A candidate mid-test must
          never see a path into them (they render in the recruiter shell).
          Recruiters reach both from the reports list / dashboard. */}
    </div>
  );
}
