"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchAttempt, fetchReport } from "@/lib/api";
import type { Attempt, Report } from "@/lib/types";

// Submission confirmation: the attempt is in, the workspace is frozen, and
// (when the backend has generated it) the report summary is already here.
export default function SubmittedPage({ params }: { params: { id: string } }) {
  const id = params.id;
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [reportPending, setReportPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const a = await fetchAttempt(id);
        if (alive) setAttempt(a);
      } catch {
        if (alive) setError("Could not load this attempt — it may not exist, or the backend is offline (:8000).");
      }
      try {
        const r = await fetchReport(id);
        if (alive) setReport(r);
      } catch {
        if (alive) setReportPending(true); // 404 = report not generated yet
      }
    })();
    return () => { alive = false; };
  }, [id]);

  if (error) return <div className="rounded border border-red-800/70 p-4 text-sm text-red-300">{error}</div>;
  if (!attempt) return <p className="text-sm text-gray-400">Loading submission…</p>;

  const tokensUsed = report?.metrics?.tokens_used ?? attempt.tokens_used;
  const tokenBudget = report?.metrics?.token_budget ?? attempt.token_budget;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <p className="text-xs uppercase tracking-wide text-gray-500">Submission received</p>
        <h1 className="mt-1 text-2xl font-bold">Attempt submitted — thank you, {attempt.candidate_name}</h1>
        <p className="mt-1 text-sm text-gray-400">Status: <span className="text-gray-200">{attempt.status}</span> · attempt <span className="font-mono">{id}</span>. The workspace is frozen and sealed into the evidence report.</p>
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded border border-gray-700 p-4">
          <p className="text-sm text-gray-400">Tokens used</p>
          <p className="text-2xl font-bold">{tokensUsed.toLocaleString()}</p>
          <p className="text-xs text-gray-500">of {tokenBudget.toLocaleString()} budget</p>
        </div>
        <div className="rounded border border-gray-700 p-4">
          <p className="text-sm text-gray-400">Total score</p>
          <p className="text-2xl font-bold">{report ? report.total_score : "—"}</p>
          <p className="text-xs text-gray-500">{report ? `functional ${report.functional_score} · AI collaboration ${report.ai_collaboration_score}` : "pending"}</p>
        </div>
        <div className="rounded border border-gray-700 p-4">
          <p className="text-sm text-gray-400">Prompts recorded</p>
          <p className="text-2xl font-bold">{report?.metrics ? report.metrics.prompts_total : "—"}</p>
          <p className="text-xs text-gray-500">{report?.metrics ? `${report.metrics.test_runs} test runs · ${report.metrics.git_snapshots} git snapshots` : "from the report, when ready"}</p>
        </div>
      </section>

      {report?.verdict ? (
        <section className="rounded border border-gray-700 p-4">
          <h2 className="font-semibold">Verdict</h2>
          <p className="mt-1 text-sm text-gray-200">{report.verdict}</p>
        </section>
      ) : null}
      {reportPending && !report ? (
        <p className="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-300">The evidence report is not available yet — it is generated at submit; check the report page shortly.</p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {/* Candidate end screen: only candidate-legit navigation. The
            evidence report and session replay are recruiter review
            surfaces — no links to them from here. */}
        <Link className="rounded border border-gray-600 px-4 py-2 text-sm text-gray-200" href={`/attempts/${id}`}>Open frozen workspace</Link>
      </div>
    </div>
  );
}
