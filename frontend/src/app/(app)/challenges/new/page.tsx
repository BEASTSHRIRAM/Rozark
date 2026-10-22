"use client";
import { useState } from "react";
import Link from "next/link";

const STEPS = ["Environment", "Project Setup", "IDE Setup", "Scoring", "Details", "AI Agent Config"] as const;
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export default function CreateChallengePage() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    title: "", stack: "python-fastapi", source: "sample", github_url: "",
    install_command: "", run_command: "", test_command: "pytest -q",
    default_open_files: "README.md", scoring_mode: "automated", scoring_format: "junit",
    difficulty: "medium", problem_description: "", allowed_agents: "claude_code, codex",
    token_budget: 100000, internet_enabled: false, agent_mode: "mentor",
  });
  const set = (k: string, v: string | number | boolean) => setForm((f) => ({ ...f, [k]: v }));
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMsg, setSaveMsg] = useState("");
  const [savedId, setSavedId] = useState("");

  async function save() {
    // Real save: POST the wizard payload to the backend /challenges
    // endpoint (shape: backend ChallengeCreate, docs/CHALLENGE_SCHEMA.md).
    setSaveState("saving"); setSaveMsg("");
    const payload = {
      title: form.title.trim(),
      difficulty: form.difficulty,
      tags: csv(form.stack),
      problem_description: form.problem_description,
      project_setup: { source: form.source, github_url: form.github_url || null },
      ide_setup: {
        install_command: form.install_command, run_command: form.run_command,
        test_command: form.test_command, default_open_files: csv(form.default_open_files),
      },
      scoring: { mode: form.scoring_mode, format: form.scoring_format },
      agent_config: {
        allowed_agents: csv(form.allowed_agents), token_budget: Number(form.token_budget) || 0,
        internet_enabled: form.internet_enabled, agent_mode: form.agent_mode,
      },
    };
    try {
      const res = await fetch(`${API}/challenges`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try { detail = (await res.json())?.detail || detail; } catch { /* keep status */ }
        throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
      }
      const created = await res.json();
      setSavedId(created.id);
      setSaveState("saved");
      setSaveMsg(`Challenge saved as ${created.id} — it now appears in the challenge library, persisted in the backend store.`);
    } catch (e) {
      setSaveState("error");
      setSaveMsg(e instanceof Error ? e.message : "Save failed — is the backend running on :8000?");
    }
  }
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Create Challenge — {STEPS[step]}</h1>
      <ol className="flex flex-wrap gap-2 text-xs">{STEPS.map((s, i) => (<li key={s} className={`rounded px-2 py-1 ${i === step ? "bg-vermillion" : "bg-gray-800"}`}>{i + 1}. {s}</li>))}</ol>
      {step === 0 && (<div className="space-y-3"><label className="block text-sm">Stack / Environment<input className="mt-1 w-full rounded bg-gray-900 p-2" value={form.stack} onChange={(e) => set("stack", e.target.value)} /></label></div>)}
      {step === 1 && (<div className="space-y-3"><label className="block text-sm">Source (upload_zip &lt;=5MB / clone_github / sample)<select className="mt-1 w-full rounded bg-gray-900 p-2" value={form.source} onChange={(e) => set("source", e.target.value)}><option value="sample">Sample project</option><option value="clone_github">Clone from GitHub</option><option value="upload_zip">Upload Zip</option></select></label>{form.source === "clone_github" && (<input className="w-full rounded bg-gray-900 p-2" placeholder="https://github.com/org/repo" value={form.github_url} onChange={(e) => set("github_url", e.target.value)} />)}</div>)}
      {step === 2 && (<div className="space-y-3">{["install_command", "run_command", "test_command", "default_open_files"].map((k) => (<label key={k} className="block text-sm">{k}<input className="mt-1 w-full rounded bg-gray-900 p-2" value={String(form[k as keyof typeof form])} onChange={(e) => set(k, e.target.value)} /></label>))}<p className="text-xs text-gray-400">Also configure read-only files and hidden files in the API payload (see docs/CHALLENGE_SCHEMA.md).</p></div>)}
      {step === 3 && (<div className="space-y-3"><label className="block text-sm">Scoring mode<select className="mt-1 w-full rounded bg-gray-900 p-2" value={form.scoring_mode} onChange={(e) => set("scoring_mode", e.target.value)}><option>automated</option><option>manual</option><option>custom</option></select></label><label className="block text-sm">Format (junit / xunit / tap / custom — custom must print FS_SCORE: XY%)<input className="mt-1 w-full rounded bg-gray-900 p-2" value={form.scoring_format} onChange={(e) => set("scoring_format", e.target.value)} /></label></div>)}
      {step === 4 && (<div className="space-y-3"><label className="block text-sm">Title<input className="mt-1 w-full rounded bg-gray-900 p-2" value={form.title} onChange={(e) => set("title", e.target.value)} /></label><label className="block text-sm">Difficulty — Easy 50/15m, Medium 75/30m, Hard 100/45-60m<select className="mt-1 w-full rounded bg-gray-900 p-2" value={form.difficulty} onChange={(e) => set("difficulty", e.target.value)}><option>easy</option><option>medium</option><option>hard</option></select></label><label className="block text-sm">Problem description<textarea className="mt-1 w-full rounded bg-gray-900 p-2" value={form.problem_description} onChange={(e) => set("problem_description", e.target.value)} /></label></div>)}
      {step === 5 && (<div className="space-y-3">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Side-panel AI mode — your choice only; the candidate can never change it</legend>
          <label className={`flex gap-2 rounded border p-3 text-sm ${form.agent_mode === "mentor" ? "border-vermillion bg-gray-900" : "border-gray-700"}`}>
            <input type="radio" name="agent_mode" value="mentor" checked={form.agent_mode === "mentor"} onChange={(e) => set("agent_mode", e.target.value)} />
            <span><strong>Mentor</strong> — explains what&apos;s wrong and points at what to check; never writes code, never touches files.</span>
          </label>
          <label className={`flex gap-2 rounded border p-3 text-sm ${form.agent_mode === "agent" ? "border-vermillion bg-gray-900" : "border-gray-700"}`}>
            <input type="radio" name="agent_mode" value="agent" checked={form.agent_mode === "agent"} onChange={(e) => set("agent_mode", e.target.value)} />
            <span><strong>Full Agent</strong> — can edit files and run commands in the candidate&apos;s sandbox; every action it takes is recorded and attributed to the agent in the report.</span>
          </label>
        </fieldset>
        <label className="block text-sm">Allowed agents (comma separated)<input className="mt-1 w-full rounded bg-gray-900 p-2" value={form.allowed_agents} onChange={(e) => set("allowed_agents", e.target.value)} /></label><label className="block text-sm">Token budget<input type="number" className="mt-1 w-full rounded bg-gray-900 p-2" value={form.token_budget} onChange={(e) => set("token_budget", Number(e.target.value))} /></label><label className="flex gap-2 text-sm"><input type="checkbox" checked={form.internet_enabled} onChange={(e) => set("internet_enabled", e.target.checked)} /> Internet enabled</label></div>)}
      <div className="flex gap-3">
        <button disabled={step === 0} className="rounded border border-gray-600 px-4 py-2 disabled:opacity-40" onClick={() => setStep(step - 1)}>Back</button>
        {step < STEPS.length - 1 ? (<button className="rounded-full bg-vermillion px-5 py-2 text-sm font-semibold text-white transition hover:bg-vermilliondeep" onClick={() => setStep(step + 1)}>Next</button>) : (<button disabled={saveState === "saving" || !form.title.trim()} className="rounded-full bg-vermillion px-5 py-2 text-sm font-semibold text-white transition hover:bg-vermilliondeep disabled:opacity-50" onClick={save}>{saveState === "saving" ? "Saving…" : "Validate & Save"}</button>)}
      </div>
      {saveState === "saved" && (
        <p className="rounded-lg border border-white/10 bg-white/[0.03] px-3.5 py-3 text-sm text-gray-200">
          ✓ {saveMsg} <Link href="/challenges" className="font-medium text-cobaltlt hover:underline">View in challenge library →</Link>
          <span className="ml-2 font-mono text-xs text-gray-500">{savedId}</span>
        </p>
      )}
      {saveState === "error" && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-3 text-sm text-red-200">
          Save failed: {saveMsg}
        </p>
      )}
      <p className="text-xs text-gray-500">Save posts to the backend (POST /challenges) and persists. Try question / live in-browser validation is still a scaffold.</p>
    </div>
  );
}
