"use client";
import { useState } from "react";

const STEPS = ["Environment", "Project Setup", "IDE Setup", "Scoring", "Details", "AI Agent Config"] as const;

export default function CreateChallengePage() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    title: "", stack: "python-fastapi", source: "sample", github_url: "",
    install_command: "", run_command: "", test_command: "pytest -q",
    default_open_files: "README.md", scoring_mode: "automated", scoring_format: "junit",
    difficulty: "medium", problem_description: "", allowed_agents: "claude_code, codex",
    token_budget: 100000, internet_enabled: false,
  });
  const set = (k: string, v: string | number | boolean) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Create Challenge — {STEPS[step]}</h1>
      <ol className="flex flex-wrap gap-2 text-xs">{STEPS.map((s, i) => (<li key={s} className={`rounded px-2 py-1 ${i === step ? "bg-indigo-600" : "bg-gray-800"}`}>{i + 1}. {s}</li>))}</ol>
      {step === 0 && (<div className="space-y-3"><label className="block text-sm">Stack / Environment<input className="mt-1 w-full rounded bg-gray-900 p-2" value={form.stack} onChange={(e) => set("stack", e.target.value)} /></label></div>)}
      {step === 1 && (<div className="space-y-3"><label className="block text-sm">Source (upload_zip &lt;=5MB / clone_github / sample)<select className="mt-1 w-full rounded bg-gray-900 p-2" value={form.source} onChange={(e) => set("source", e.target.value)}><option value="sample">Sample project</option><option value="clone_github">Clone from GitHub</option><option value="upload_zip">Upload Zip</option></select></label>{form.source === "clone_github" && (<input className="w-full rounded bg-gray-900 p-2" placeholder="https://github.com/org/repo" value={form.github_url} onChange={(e) => set("github_url", e.target.value)} />)}</div>)}
      {step === 2 && (<div className="space-y-3">{["install_command", "run_command", "test_command", "default_open_files"].map((k) => (<label key={k} className="block text-sm">{k}<input className="mt-1 w-full rounded bg-gray-900 p-2" value={String(form[k as keyof typeof form])} onChange={(e) => set(k, e.target.value)} /></label>))}<p className="text-xs text-gray-400">Also configure read-only files and hidden files in the API payload (see docs/CHALLENGE_SCHEMA.md).</p></div>)}
      {step === 3 && (<div className="space-y-3"><label className="block text-sm">Scoring mode<select className="mt-1 w-full rounded bg-gray-900 p-2" value={form.scoring_mode} onChange={(e) => set("scoring_mode", e.target.value)}><option>automated</option><option>manual</option><option>custom</option></select></label><label className="block text-sm">Format (junit / xunit / tap / custom — custom must print FS_SCORE: XY%)<input className="mt-1 w-full rounded bg-gray-900 p-2" value={form.scoring_format} onChange={(e) => set("scoring_format", e.target.value)} /></label></div>)}
      {step === 4 && (<div className="space-y-3"><label className="block text-sm">Title<input className="mt-1 w-full rounded bg-gray-900 p-2" value={form.title} onChange={(e) => set("title", e.target.value)} /></label><label className="block text-sm">Difficulty — Easy 50/15m, Medium 75/30m, Hard 100/45-60m<select className="mt-1 w-full rounded bg-gray-900 p-2" value={form.difficulty} onChange={(e) => set("difficulty", e.target.value)}><option>easy</option><option>medium</option><option>hard</option></select></label><label className="block text-sm">Problem description<textarea className="mt-1 w-full rounded bg-gray-900 p-2" value={form.problem_description} onChange={(e) => set("problem_description", e.target.value)} /></label></div>)}
      {step === 5 && (<div className="space-y-3"><label className="block text-sm">Allowed agents (comma separated)<input className="mt-1 w-full rounded bg-gray-900 p-2" value={form.allowed_agents} onChange={(e) => set("allowed_agents", e.target.value)} /></label><label className="block text-sm">Token budget<input type="number" className="mt-1 w-full rounded bg-gray-900 p-2" value={form.token_budget} onChange={(e) => set("token_budget", Number(e.target.value))} /></label><label className="flex gap-2 text-sm"><input type="checkbox" checked={form.internet_enabled} onChange={(e) => set("internet_enabled", e.target.checked)} /> Internet enabled</label></div>)}
      <div className="flex gap-3">
        <button disabled={step === 0} className="rounded border border-gray-600 px-4 py-2 disabled:opacity-40" onClick={() => setStep(step - 1)}>Back</button>
        {step < STEPS.length - 1 ? (<button className="rounded bg-indigo-600 px-4 py-2" onClick={() => setStep(step + 1)}>Next</button>) : (<button className="rounded bg-green-600 px-4 py-2" onClick={() => alert("MVP stub: POST this payload to /challenges — see docs/CHALLENGE_SCHEMA.md\n" + JSON.stringify(form, null, 2))}>Validate &amp; Save (stub)</button>)}
      </div>
      <p className="text-xs text-gray-500">Try question / live validation is a stub in the MVP scaffold.</p>
    </div>
  );
}
