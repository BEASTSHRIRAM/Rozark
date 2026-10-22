"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchAttempt, fetchChallenge, fetchSession, startSandbox } from "@/lib/api";
import type { Attempt, Challenge, SessionStatus } from "@/lib/types";

// Candidate lobby: shown before the attempt workspace. Confirms who is
// taking which challenge, states the rules (time limit, token budget, what
// is recorded, read-only files), and starts the sandbox on entry.
export default function LobbyPage({ params }: { params: { id: string } }) {
  const id = params.id;
  const router = useRouter();
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const a = await fetchAttempt(id);
        if (!alive) return;
        setAttempt(a);
        const c = await fetchChallenge(a.challenge_id).catch(() => null);
        if (alive && c) setChallenge(c);
        const s = await fetchSession(id).catch(() => null);
        if (alive && s) setSession(s);
      } catch {
        if (alive) setError("Could not load this attempt — it may not exist, or the backend is offline (:8000).");
      }
    })();
    return () => { alive = false; };
  }, [id]);

  const sandboxActive = !!session && /active|running|live|started/i.test(session.sandbox_status || "");

  async function enter() {
    if (sandboxActive) { router.push(`/attempts/${id}`); return; }
    setStarting(true); setError("");
    try {
      await startSandbox(id);
      router.push(`/attempts/${id}`);
    } catch {
      setError("Could not start the sandbox — is the backend running on :8000?");
      setStarting(false);
    }
  }

  if (error && !attempt) return <div className="rounded border border-red-800/70 p-4 text-sm text-red-300">{error}</div>;
  if (!attempt) return <p className="text-sm text-gray-400">Loading lobby…</p>;

  if (attempt.status === "submitted") {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold">This attempt is already submitted</h1>
        <p className="text-sm text-gray-300">{attempt.candidate_name}&apos;s attempt at {challenge?.title || "this challenge"} has been submitted and the workspace is frozen.</p>
        <Link className="inline-block rounded bg-vermilliondeep px-4 py-2 text-sm font-semibold text-white" href={`/attempts/${id}/submitted`}>View submission summary →</Link>
      </div>
    );
  }

  const timeLimit = session?.time_limit_minutes ?? challenge?.agent_config.time_limit_minutes ?? challenge?.recommended_time_minutes ?? attempt.time_limit_minutes;
  const budget = session?.budget.budget ?? attempt.token_budget ?? challenge?.agent_config.token_budget;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <p className="text-xs uppercase tracking-wide text-gray-500">Candidate lobby</p>
        <h1 className="mt-1 text-2xl font-bold">{challenge?.title || "Your challenge"}</h1>
        <p className="mt-1 text-sm text-gray-400">Candidate: <span className="text-gray-200">{attempt.candidate_name}</span>{attempt.candidate_email ? <span className="text-gray-500"> · {attempt.candidate_email}</span> : null}</p>
      </div>

      {challenge?.problem_description ? (
        <section className="rounded border border-gray-700 p-4">
          <h2 className="font-semibold">The brief</h2>
          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-300">{challenge.problem_description}</p>
        </section>
      ) : null}

      <section className="rounded border border-gray-700 p-4">
        <h2 className="font-semibold">Rules</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-gray-300">
          {timeLimit ? <li>Time limit: <strong>{timeLimit} minutes</strong> — the countdown starts with your session and the workspace freezes at submit or expiry.</li> : null}
          {budget ? <li>AI token budget: <strong>{budget.toLocaleString()} tokens</strong>, tracked per phase (planning / building / debugging). A hard stop may apply when the budget is exhausted.</li> : null}
          <li>Everything is recorded as one ordered event log: <strong>terminal commands and output</strong>, <strong>file edits</strong>, <strong>agent prompts, responses and tool calls</strong>, test runs and git snapshots.</li>
          {challenge?.ide_setup.read_only_files.length ? <li>Read-only files (cannot be edited): <span className="font-mono text-xs">{challenge.ide_setup.read_only_files.join(", ")}</span></li> : null}
          {challenge?.ide_setup.hidden_files.length ? <li>Some test files are hidden; the hidden suite runs at submit and its source is never shown.</li> : null}
          <li>You may use the built-in AI agent panel and the live terminal. Paste events are logged — just work the way you normally would.</li>
        </ul>
      </section>

      {error && <p className="rounded border border-red-800/70 px-3 py-2 text-xs text-red-300">{error}</p>}
      <button onClick={enter} disabled={starting} className="rounded bg-vermilliondeep px-6 py-3 text-base font-semibold text-white disabled:opacity-50">
        {starting ? "Starting sandbox…" : sandboxActive ? "Resume attempt →" : "Start attempt →"}
      </button>
      <p className="text-xs text-gray-500">{sandboxActive ? "A sandbox session is already active for this attempt — resume goes straight into the workspace." : "Start creates your isolated sandbox workspace and opens the attempt. The timer runs from the session expiry shown inside."}</p>
    </div>
  );
}
