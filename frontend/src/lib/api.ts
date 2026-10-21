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
export const sampleChallenges=[{id:"chal_0001",title:"Fix the orders API pagination bug",type:"backend",difficulty:"medium" as const,score:75,recommended_time_minutes:30,tags:["python","fastapi","debugging"],problem_description:"The /items endpoint returns duplicates across pages.",agent_config:{allowed_agents:["claude_code","codex"],token_budget:100000,internet_enabled:false},rubric_weights:{functional:0.4,ai_collaboration:0.6},ide_setup:{install_command:"pip install -r requirements.txt",run_command:"python -m app.main",test_command:"pytest -q",default_open_files:["README.md","app/main.py"],read_only_files:["README.md"],hidden_files:["tests/test_hidden.py"]}}];
