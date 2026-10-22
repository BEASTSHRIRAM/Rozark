const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// --- Live sandbox sessions (backend app/sandbox.py, docs/SANDBOX.md) ---
export type SandboxSession = {
  attempt_id: string; session_id: string; workspace_id: string; workspace_path: string;
  backend: string; backend_note: string; status: string; ws_url: string;
  started_at: string; expires_at: string; time_limit_minutes: number;
};

export async function startSandbox(attemptId: string): Promise<SandboxSession> {
  const res = await fetch(`${API}/attempts/${attemptId}/sandbox/start`, { method: "POST" });
  if (!res.ok) throw new Error(`sandbox start failed: ${res.status}`);
  return res.json();
}

export async function stopSandbox(attemptId: string): Promise<SandboxSession> {
  const res = await fetch(`${API}/attempts/${attemptId}/sandbox/stop`, { method: "POST" });
  if (!res.ok) throw new Error(`sandbox stop failed: ${res.status}`);
  return res.json();
}
export async function fetchChallenges(){ try{ const r=await fetch(`${API}/challenges`,{cache:"no-store"}); if(!r.ok) throw new Error("bad"); return await r.json(); }catch{ return sampleChallenges; } }
export const sampleChallenges=[{id:"chal_0001",title:"Fix the orders API pagination bug",type:"backend",difficulty:"medium" as const,score:75,recommended_time_minutes:30,tags:["python","fastapi","debugging"],problem_description:"The /items endpoint returns duplicates across pages.",agent_config:{allowed_agents:["claude_code","codex"],token_budget:100000,internet_enabled:false,agent_mode:"mentor"},rubric_weights:{functional:0.4,ai_collaboration:0.6},ide_setup:{install_command:"pip install -r requirements.txt",run_command:"python -m app.main",test_command:"pytest -q",default_open_files:["README.md","app/main.py"],read_only_files:["README.md"],hidden_files:["tests/test_hidden.py"]}}];

// --- Live attempt / editor / agent / scoring / report contracts -----------
// Fixed API contracts implemented by the backend (overnight build). Every
// helper throws ApiError with the HTTP status + parsed `detail` on failure
// so pages can distinguish 404 (not submitted), 403 (read-only / budget
// hard stop), 409 (no workspace yet) and 503 (agent not configured).
import type { AgentChatResult, AgentStatus, Attempt, Challenge, FileContent, FileList, PublicTests, Report, Replay, ScoreSummary, ScoreRun, SessionEvent, SessionStatus, TokenBudget } from "./types";

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown, message?: string) {
    super(message || `API request failed: ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { cache: "no-store", ...init });
  if (!res.ok) {
    let detail: unknown = null;
    try { const body = await res.json(); detail = body?.detail ?? body; } catch { /* non-JSON error body */ }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

const jsonInit = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export function fetchAttempt(id: string): Promise<Attempt> { return req(`/attempts/${id}`); }
export function fetchAttempts(challengeId?: string): Promise<Attempt[]> { return req(`/attempts${challengeId ? `?challenge_id=${encodeURIComponent(challengeId)}` : ""}`); }
export function createAttempt(body: { challenge_id: string; candidate_name: string; candidate_email: string }): Promise<Attempt> { return req(`/attempts`, jsonInit("POST", body)); }
export function fetchChallenge(id: string): Promise<Challenge> { return req(`/challenges/${id}`); }
export function fetchBudget(id: string): Promise<TokenBudget> { return req(`/attempts/${id}/budget`); }
export function fetchSession(id: string): Promise<SessionStatus> { return req(`/attempts/${id}/session`); }
export function heartbeat(id: string): Promise<SessionStatus> { return req(`/attempts/${id}/heartbeat`, { method: "POST" }); }
export function listFiles(id: string): Promise<FileList> { return req(`/attempts/${id}/files`); }
export function readFile(id: string, path: string): Promise<FileContent> { return req(`/attempts/${id}/files/content?path=${encodeURIComponent(path)}`); }
export function writeFile(id: string, path: string, content: string): Promise<{ path: string; size: number }> { return req(`/attempts/${id}/files/content`, jsonInit("PUT", { path, content })); }
export function fetchEvents(id: string, opts?: { types?: string[]; sinceSeq?: number }): Promise<SessionEvent[]> {
  const q = new URLSearchParams();
  if (opts?.types?.length) q.set("types", opts.types.join(","));
  if (opts?.sinceSeq !== undefined) q.set("since_seq", String(opts.sinceSeq));
  const s = q.toString();
  return req(`/attempts/${id}/events${s ? `?${s}` : ""}`);
}
export function runScore(id: string): Promise<ScoreRun> { return req(`/attempts/${id}/score/run`, { method: "POST" }); }
export function fetchScore(id: string): Promise<ScoreSummary> { return req(`/attempts/${id}/score`); }
export function submitAttempt(id: string): Promise<Report> { return req(`/attempts/${id}/submit`, jsonInit("POST", {})); }
export function fetchReport(id: string): Promise<Report> { return req(`/attempts/${id}/report`); }
export function fetchReplay(id: string): Promise<Replay> { return req(`/attempts/${id}/replay`); }
export function agentStatus(): Promise<AgentStatus> { return req(`/agent/status`); }
export function agentChat(id: string, body: { prompt: string; phase: string; mode?: string }): Promise<AgentChatResult> { return req(`/attempts/${id}/agent/chat`, jsonInit("POST", body)); }
export function fetchPublicTests(id: string): Promise<PublicTests> { return req(`/attempts/${id}/tests/public`); }
