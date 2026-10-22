"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SandboxTerminal, { type SandboxControls, type SandboxUiState } from "@/components/SandboxTerminal";
import CodeEditor, { EDITOR_BG } from "@/components/CodeEditor";
import AgentPanel from "@/components/AgentPanel";
import PublicTestsPanel from "@/components/PublicTestsPanel";
import { ApiError, fetchAttempt, fetchBudget, fetchChallenge, fetchEvents, fetchPublicTests, fetchSession, heartbeat, listFiles, readFile, runScore, startSandbox, submitAttempt, writeFile } from "@/lib/api";
import type { Attempt, Challenge, PublicTests, SessionEvent, SessionStatus, TokenBudget, WorkspaceFile } from "@/lib/types";

// ---------------------------------------------------------------------------
// Attempt workspace — VS CODE WORKBENCH layout, LIVE data.
// Activity bar (far left, ink) toggles the primary sidebar between
// EXPLORER (real folder tree, 🔒 on read-only files) / BRIEF (challenge
// description + scoring card) / SEARCH (filter the tree), and focuses the
// right-side MENTOR / TESTS panels. Editor area: VS Code tabs (dirty dot,
// lock on read-only, close ×) + breadcrumb path + Monaco (rozark-ink
// theme, Ctrl+S saves via the files API). Bottom panel tabs: Terminal
// (live websocket PTY) | Problems (latest public-test failures) | Output
// (session event log). Status bar: sandbox state + Start/Stop, file
// language + Ln/Col, token budget mirror + countdown mirror.
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

function languageLabel(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    py: "Python", ts: "TypeScript", tsx: "TypeScript React", js: "JavaScript", jsx: "JavaScript React",
    json: "JSON", md: "Markdown", html: "HTML", css: "CSS", sh: "Shell", bash: "Shell",
    yml: "YAML", yaml: "YAML", toml: "TOML", txt: "Plain Text", sql: "SQL", go: "Go",
    java: "Java", rs: "Rust", c: "C", cpp: "C++",
  };
  return map[ext] || "Plain Text";
}

const extDot: Record<string, string> = {
  py: "bg-cobaltlt", ts: "bg-cobaltlt", tsx: "bg-cobaltlt", js: "bg-[#E0A458]", jsx: "bg-[#E0A458]",
  json: "bg-stonewarm", md: "bg-paper", css: "bg-sagelt", html: "bg-vermillion", sh: "bg-sage", bash: "bg-sage",
  toml: "bg-stonewarm", yml: "bg-stonewarm", yaml: "bg-stonewarm",
};

// --- folder tree built from the flat files-API list -------------------------
interface TreeFolder { kind: "folder"; name: string; path: string; children: TreeNode[]; }
interface TreeFile { kind: "file"; name: string; path: string; file: WorkspaceFile; }
type TreeNode = TreeFolder | TreeFile;

function buildTree(files: WorkspaceFile[]): TreeNode[] {
  const root: TreeFolder = { kind: "folder", name: "", path: "", children: [] };
  for (const f of files) {
    const parts = f.path.split("/");
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts.slice(0, i + 1).join("/");
      let next = cur.children.find((c): c is TreeFolder => c.kind === "folder" && c.path === p);
      if (!next) { next = { kind: "folder", name: parts[i], path: p, children: [] }; cur.children.push(next); }
      cur = next;
    }
    cur.children.push({ kind: "file", name: parts[parts.length - 1], path: f.path, file: f });
  }
  const sortNodes = (ns: TreeNode[]) => {
    ns.sort((a, b) => (a.kind !== b.kind ? (a.kind === "folder" ? -1 : 1) : a.name.localeCompare(b.name)));
    ns.forEach((n) => { if (n.kind === "folder") sortNodes(n.children); });
  };
  sortNodes(root.children);
  return root.children;
}

function FileTree({ nodes, depth, activePath, collapsed, onToggle, onOpen }: {
  nodes: TreeNode[];
  depth: number;
  activePath: string;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
}) {
  return (
    <ul className="space-y-0.5 font-mono text-xs">
      {nodes.map((n) => {
        if (n.kind === "folder") {
          const isCollapsed = collapsed.has(n.path);
          return (
            <li key={n.path}>
              <button
                onClick={() => onToggle(n.path)}
                className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-gray-300 hover:bg-gray-800"
                style={{ paddingLeft: `${depth * 12 + 4}px` }}
              >
                <span className="text-[9px] text-gray-500">{isCollapsed ? "▸" : "▾"}</span>
                <span className="text-[#E0A458]">🗀</span>
                <span>{n.name}</span>
              </button>
              {!isCollapsed && (
                <FileTree nodes={n.children} depth={depth + 1} activePath={activePath} collapsed={collapsed} onToggle={onToggle} onOpen={onOpen} />
              )}
            </li>
          );
        }
        const ext = n.name.split(".").pop()?.toLowerCase() || "";
        return (
          <li key={n.path}>
            <button
              onClick={() => onOpen(n.path)}
              className={`flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left ${n.path === activePath ? "bg-gray-800 text-gray-100" : "text-gray-400 hover:bg-gray-800/60"}`}
              style={{ paddingLeft: `${depth * 12 + 16}px` }}
              title={n.path}
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${extDot[ext] || "bg-gray-500"}`} />
              <span className="truncate">{n.name}</span>
              {n.file.read_only ? <span className="ml-auto shrink-0 text-[10px]" title="Read-only file">🔒</span> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// --- activity bar icon button ------------------------------------------------
function ActBtn({ active, title, onClick, children }: {
  active?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`relative grid h-11 w-12 place-items-center transition ${active ? "text-paper" : "text-paper/40 hover:text-paper/80"}`}
    >
      {active && <span className="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 bg-paper" />}
      <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
    </button>
  );
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

function eventSummary(e: SessionEvent): string {
  const p = e.payload || {};
  for (const k of ["message", "command", "text", "prompt", "response_text", "path", "action", "file"]) {
    const v = p[k];
    if (typeof v === "string" && v) return v.length > 140 ? `${v.slice(0, 140)}…` : v;
  }
  try {
    const s = JSON.stringify(p);
    return s.length > 140 ? `${s.slice(0, 140)}…` : s;
  } catch { return ""; }
}

type SidebarView = "explorer" | "brief" | "search";
type PanelTab = "terminal" | "problems" | "output";

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

  // --- workbench UI state ---------------------------------------------------
  const [sidebarView, setSidebarView] = useState<SidebarView>("explorer");
  const [panelTab, setPanelTab] = useState<PanelTab>("terminal");
  const [panelOpen, setPanelOpen] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [fileFilter, setFileFilter] = useState("");
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [sandboxUi, setSandboxUi] = useState<SandboxUiState>({ state: "idle" });
  const termControls = useRef<SandboxControls | null>(null);
  const [pubTests, setPubTests] = useState<PublicTests | null>(null);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const outputRef = useRef<HTMLDivElement>(null);

  const submitted = attempt?.status === "submitted";
  const active = tabs.find((t) => t.path === activePath) || null;
  const visibleFiles = useMemo(() => files.filter((f) => !f.hidden), [files]);
  const tree = useMemo(() => buildTree(visibleFiles), [visibleFiles]);

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

  // --- public tests poll (15s) — drives the Problems tab -------------------
  useEffect(() => {
    let alive = true;
    const poll = async () => { try { const d = await fetchPublicTests(id); if (alive) setPubTests(d); } catch { /* keep last */ } };
    poll();
    const iv = setInterval(poll, 15000);
    return () => { alive = false; clearInterval(iv); };
  }, [id]);

  // --- events poll (10s) — drives the Output tab ---------------------------
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const evs = await fetchEvents(id);
        if (alive) setEvents([...evs].sort((a, b) => (a.seq ?? a.sequence) - (b.seq ?? b.sequence)));
      } catch { /* keep last */ }
    };
    poll();
    const iv = setInterval(poll, 10000);
    return () => { alive = false; clearInterval(iv); };
  }, [id]);

  // Keep the Output pane pinned to the newest event while it is visible.
  useEffect(() => {
    if (panelTab === "output" && outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [events, panelTab, panelOpen]);

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

  function toggleFolder(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }

  function focusPanel(domId: string) {
    document.getElementById(domId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function statusStart() {
    termControls.current?.start();
    // The terminal start materialises the workspace server-side; refresh
    // the file list shortly after so the tree fills in.
    setTimeout(() => { loadFiles(); }, 1200);
  }

  const remaining = session?.expires_at ? Math.max(0, (new Date(session.expires_at).getTime() - now) / 1000) : session ? session.remaining_seconds : null;
  const elapsedPct = session?.time_limit_minutes && remaining !== null ? Math.min(100, Math.max(0, (1 - remaining / (session.time_limit_minutes * 60)) * 100)) : 0;

  // Problems = failed/errored public tests + error events from the log.
  const problems: { key: string; title: string; detail: string }[] = [];
  if (pubTests?.run_id) {
    for (const t of pubTests.tests) {
      if (t.status === "failed" || t.status === "error") {
        const detail = t.expected || t.received
          ? `expected ${t.expected || "—"} · received ${t.received || "—"}`
          : (t.message || t.status);
        problems.push({ key: `test-${t.name}`, title: t.name, detail });
      }
    }
  }
  for (const e of events) {
    if (e.type.includes("error")) {
      problems.push({ key: `ev-${e.id}`, title: e.type, detail: eventSummary(e) });
    }
  }

  const sandboxLabel: Record<string, string> = {
    idle: "sandbox stopped", starting: "sandbox starting…", live: "live",
    offline: "sandbox offline", closed: submitted ? "sandbox frozen" : "sandbox stopped",
  };
  const sandboxDot: Record<string, string> = {
    idle: "bg-paper/40", starting: "bg-[#E0A458]", live: "bg-sagelt", offline: "bg-red-400", closed: "bg-paper/40",
  };

  if (loadError) {
    return <div className="rounded border border-red-800/70 p-4 text-sm text-red-300">{loadError}</div>;
  }
  if (!attempt) return <p className="text-sm text-gray-400">Loading attempt…</p>;

  const crumbs = active ? active.path.split("/") : [];

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

      {/* ======================= VS CODE WORKBENCH ======================= */}
      <section className="overflow-hidden rounded border border-gray-700">
        <div className="flex flex-col lg:flex-row">
          {/* ----- activity bar + primary sidebar + editor stack ----- */}
          <div className="flex min-w-0 flex-1">
            {/* ACTIVITY BAR */}
            <div className="flex w-12 shrink-0 flex-col items-center bg-ink py-1">
              <ActBtn active={sidebarView === "explorer"} title="Explorer" onClick={() => setSidebarView("explorer")}>
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </ActBtn>
              <ActBtn active={sidebarView === "brief"} title="Brief — question description" onClick={() => setSidebarView("brief")}>
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </ActBtn>
              <ActBtn active={sidebarView === "search"} title="Search files" onClick={() => setSidebarView("search")}>
                <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" />
              </ActBtn>
              <ActBtn title="Tests — jump to the tests panel" onClick={() => focusPanel("rz-tests")}>
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
              </ActBtn>
              <ActBtn title="Mentor — jump to the mentor panel" onClick={() => focusPanel("rz-mentor")}>
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </ActBtn>
            </div>

            {/* PRIMARY SIDEBAR + EDITOR / PANEL COLUMN */}
            <div className="flex min-w-0 flex-1 flex-col md:flex-row">
              {/* PRIMARY SIDEBAR */}
              <aside className="w-full shrink-0 overflow-y-auto border-b border-gray-700 bg-gray-900/40 md:w-[260px] md:border-b-0 md:border-r lg:max-h-[880px]">
                {sidebarView === "explorer" && (
                  <div className="p-2">
                    <p className="px-1 text-[11px] uppercase tracking-widest text-gray-500">Explorer</p>
                    {noWorkspace ? (
                      <p className="mt-2 px-1 text-xs leading-5 text-gray-500">No workspace yet — start the sandbox (status bar or terminal tab) to load the project files.</p>
                    ) : visibleFiles.length ? (
                      <div className="mt-1.5">
                        <FileTree nodes={tree} depth={0} activePath={activePath} collapsed={collapsed} onToggle={toggleFolder} onOpen={openFile} />
                      </div>
                    ) : (
                      <p className="mt-2 px-1 text-xs text-gray-500">Loading files…</p>
                    )}
                    {filesError && <p className="mt-2 px-1 text-[11px] text-red-300">{filesError}</p>}
                  </div>
                )}
                {sidebarView === "search" && (
                  <div className="p-2">
                    <p className="px-1 text-[11px] uppercase tracking-widest text-gray-500">Search files</p>
                    <input
                      value={fileFilter}
                      onChange={(e) => setFileFilter(e.target.value)}
                      placeholder="Filter by name or path…"
                      className="mt-2 w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 font-mono text-xs text-gray-100 outline-none placeholder:text-gray-600 focus:border-cobalt"
                    />
                    <ul className="mt-2 space-y-0.5 font-mono text-xs">
                      {visibleFiles
                        .filter((f) => !fileFilter || f.path.toLowerCase().includes(fileFilter.toLowerCase()))
                        .map((f) => (
                          <li key={f.path}>
                            <button onClick={() => openFile(f.path)} className={`flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left ${f.path === activePath ? "bg-gray-800 text-gray-100" : "text-gray-400 hover:bg-gray-800/60"}`}>
                              <span className="truncate">{f.path}</span>
                              {f.read_only ? <span className="ml-auto shrink-0 text-[10px]">🔒</span> : null}
                            </button>
                          </li>
                        ))}
                    </ul>
                    {fileFilter && !visibleFiles.some((f) => f.path.toLowerCase().includes(fileFilter.toLowerCase())) && (
                      <p className="mt-2 px-1 text-[11px] text-gray-500">No files match “{fileFilter}”.</p>
                    )}
                  </div>
                )}
                {sidebarView === "brief" && (
                  <div className="space-y-4 p-4">
                    <div>
                      <h2 className="text-[11px] font-semibold uppercase tracking-widest text-gray-500">Brief</h2>
                      <p className="mt-2 whitespace-pre-wrap text-sm text-gray-300">{challenge?.problem_description || "Loading challenge…"}</p>
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
                  </div>
                )}
              </aside>

              {/* EDITOR + BOTTOM PANEL COLUMN */}
              <div className="flex min-w-0 flex-1 flex-col">
                {noWorkspace ? (
                  <div className="space-y-3 p-6">
                    <p className="font-semibold">No workspace yet</p>
                    <p className="max-w-lg text-sm text-gray-400">Start the sandbox to load the workspace — an isolated copy of the challenge project is created for this attempt, and the editor + terminal work in it.</p>
                    <button onClick={startWorkspace} disabled={startingWs} className="rounded bg-vermilliondeep px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{startingWs ? "Starting…" : "Start sandbox to load the workspace"}</button>
                    {filesError && <p className="text-xs text-red-300">{filesError}</p>}
                  </div>
                ) : (
                  <>
                    {/* TAB BAR */}
                    <div className="flex flex-wrap items-stretch border-b border-gray-700 bg-gray-900 text-xs">
                      {tabs.map((t) => {
                        const dirty = t.content !== t.saved;
                        const name = t.path.split("/").pop();
                        return (
                          <span key={t.path} className={`group flex items-center gap-1.5 border-r border-gray-700 py-2 pl-3 pr-2 font-mono ${t.path === activePath ? "text-gray-100" : "text-gray-500"}`} style={t.path === activePath ? { background: EDITOR_BG } : undefined}>
                            <button onClick={() => setActivePath(t.path)} title={t.path}>{name}</button>
                            {t.readOnly && <span className="text-[10px]" title="Read-only file">🔒</span>}
                            <span className="relative grid h-4 w-4 place-items-center">
                              {dirty && <span className="text-[9px] text-paper group-hover:hidden">●</span>}
                              <button aria-label={`Close ${t.path}`} onClick={() => closeTab(t.path)} className={`text-gray-500 hover:text-gray-200 ${dirty ? "hidden group-hover:block" : ""}`}>×</button>
                            </span>
                          </span>
                        );
                      })}
                      <span className="ml-auto flex items-center gap-2 px-3 py-1.5">
                        {saveMsg && <span className="text-[11px] text-gray-400">{saveMsg}</span>}
                        <button onClick={saveActive} disabled={!active || active.readOnly || submitted || saving || active.content === active.saved} className="rounded border border-gray-600 px-2.5 py-1 text-[11px] text-gray-200 disabled:opacity-40">{saving ? "Saving…" : "Save"}</button>
                      </span>
                    </div>
                    {/* BREADCRUMB */}
                    <div className="flex items-center gap-1.5 border-b border-gray-800 px-3 py-1.5 font-mono text-[11px] text-gray-500" style={{ background: EDITOR_BG }}>
                      <span>workspace</span>
                      {crumbs.map((seg, i) => (
                        <span key={i} className="flex items-center gap-1.5">
                          <span className="text-gray-700">›</span>
                          <span className={i === crumbs.length - 1 ? "text-gray-200" : ""}>{seg}</span>
                        </span>
                      ))}
                      {active?.readOnly && <span className="ml-1 text-[10px] text-gray-500">· read-only</span>}
                    </div>
                    {/* EDITOR */}
                    <div className="h-[430px]">
                      {active ? (
                        <CodeEditor
                          path={active.path}
                          value={active.content}
                          readOnly={active.readOnly || !!submitted}
                          onChange={(v) => setTabs((prev) => prev.map((t) => t.path === active.path ? { ...t, content: v } : t))}
                          onSave={saveActive}
                          onCursor={(line, col) => setCursor({ line, col })}
                        />
                      ) : (
                        <p className="p-4 font-mono text-xs text-gray-500" style={{ background: EDITOR_BG }}>Select a file from the explorer to edit it.</p>
                      )}
                    </div>
                  </>
                )}

                {/* BOTTOM PANEL */}
                <div className="border-t border-gray-700">
                  <div className="flex items-center gap-1 bg-gray-900/60 px-2">
                    {([["terminal", "Terminal"], ["problems", "Problems"], ["output", "Output"]] as [PanelTab, string][]).map(([key, label]) => (
                      <button
                        key={key}
                        onClick={() => { setPanelTab(key); setPanelOpen(true); }}
                        className={`flex items-center gap-1.5 border-b-2 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide ${panelTab === key && panelOpen ? "border-vermillion text-gray-100" : "border-transparent text-gray-500 hover:text-gray-300"}`}
                      >
                        {label}
                        {key === "problems" && problems.length > 0 && (
                          <span className="rounded-full bg-red-500/20 px-1.5 text-[10px] font-bold normal-case tracking-normal text-red-300">{problems.length}</span>
                        )}
                      </button>
                    ))}
                    <button onClick={() => setPanelOpen((o) => !o)} title={panelOpen ? "Collapse panel" : "Expand panel"} className="ml-auto px-2 py-1.5 text-xs text-gray-500 hover:text-gray-300">{panelOpen ? "▾" : "▸"}</button>
                  </div>
                  <div className={panelOpen ? "" : "hidden"}>
                    {/* Terminal stays MOUNTED across tab switches — unmounting
                        would drop the websocket PTY. */}
                    <div className={panelTab === "terminal" ? "h-[330px] bg-gray-900/60 p-3" : "hidden"}>
                      <div className="flex h-full flex-col">
                        <SandboxTerminal attemptId={id} submitted={!!submitted} onStateChange={setSandboxUi} controlsRef={termControls} />
                      </div>
                    </div>
                    <div className={panelTab === "problems" ? "h-[330px] overflow-y-auto p-3" : "hidden"}>
                      {!pubTests?.run_id && problems.length === 0 ? (
                        <p className="text-xs text-gray-500">No scoring run yet — run the tests from the terminal or submit, and failures will appear here as problems.</p>
                      ) : problems.length === 0 ? (
                        <p className="text-xs text-sagelt">✓ No problems — the latest public run is clean.</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {problems.map((p) => (
                            <li key={p.key} className="flex items-baseline gap-2 font-mono text-xs">
                              <span className="shrink-0 text-red-400">✗</span>
                              <span className="shrink-0 text-gray-100">{p.title}</span>
                              <span className="truncate text-gray-500" title={p.detail}>{p.detail}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div ref={outputRef} className={panelTab === "output" ? "h-[330px] overflow-y-auto p-3" : "hidden"}>
                      {events.length === 0 ? (
                        <p className="text-xs text-gray-500">No session events yet — everything you do in this workspace is recorded here.</p>
                      ) : (
                        <ul className="space-y-1 font-mono text-[11px] leading-5">
                          {events.slice(-200).map((e) => (
                            <li key={e.id} className="flex gap-2">
                              <span className="shrink-0 text-gray-600">#{e.seq ?? e.sequence}</span>
                              <span className="shrink-0 text-gray-500">{e.ts ? new Date(e.ts).toLocaleTimeString() : ""}</span>
                              <span className="shrink-0 text-cobaltlt">{e.type}</span>
                              <span className="truncate text-gray-400" title={eventSummary(e)}>{eventSummary(e)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* SECONDARY SIDEBAR — mentor + public tests (unchanged panels) */}
          <div className="w-full shrink-0 space-y-4 p-3 lg:max-h-[880px] lg:w-[330px] lg:overflow-y-auto">
            <div id="rz-mentor" className="scroll-mt-24">
              <AgentPanel attemptId={id} submitted={!!submitted} onBudget={setBudget} />
            </div>
            <div id="rz-tests" className="scroll-mt-24">
              <PublicTestsPanel attemptId={id} />
            </div>
          </div>
        </div>

        {/* STATUS BAR */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 bg-ink px-3 py-1 text-[11px] text-paper">
          <span className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${sandboxDot[sandboxUi.state] || "bg-paper/40"}`} />
            <span>rozark-sandbox · {sandboxLabel[sandboxUi.state] || sandboxUi.state}{sandboxUi.backend ? ` · ${sandboxUi.backend}` : ""}</span>
            {sandboxUi.state === "live" ? (
              <button onClick={() => termControls.current?.stop()} className="rounded border border-paper/25 px-1.5 py-px text-[10px] text-paper/80 hover:bg-white/10">Stop</button>
            ) : (
              <button onClick={statusStart} disabled={!!submitted || sandboxUi.state === "starting"} className="rounded border border-paper/25 px-1.5 py-px text-[10px] text-paper/80 hover:bg-white/10 disabled:opacity-40">Start</button>
            )}
          </span>
          <span className="text-paper/60">
            {active ? `${languageLabel(active.path)} · Ln ${cursor.line}, Col ${cursor.col}` : "no file open"}
          </span>
          <span className="ml-auto flex items-center gap-4">
            <span className="text-paper/70">{budget ? `${budget.used.toLocaleString()} / ${budget.budget.toLocaleString()} tokens` : "tokens …"}</span>
            <span>⏱ {remaining !== null ? fmtClock(remaining) : "--:--"} left</span>
            <span className="text-sagelt">recorded ●</span>
          </span>
        </div>
      </section>

      {/* No footer links here on purpose: the evidence report and session
          replay are RECRUITER review surfaces. A candidate mid-test must
          never see a path into them (they render in the recruiter shell).
          Recruiters reach both from the reports list / dashboard. */}
    </div>
  );
}
