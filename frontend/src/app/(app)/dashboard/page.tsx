import Link from "next/link";
import { fetchAttempts, fetchChallenges } from "@/lib/api";

export default async function DashboardPage() {
  const challenges = await fetchChallenges();
  const latest = challenges.slice(0, 3);
  // Resolve each challenge's most recent attempt so the link targets a real
  // attempt id. Linking the challenge id produced dead /attempts/<challenge>
  // routes. Challenges with no attempts get a muted note instead of a link.
  const cards = await Promise.all(
    latest.map(async (c: any) => {
      try {
        const atts = await fetchAttempts(c.id);
        const sorted = [...atts].sort((a: any, b: any) =>
          String(b.started_at || "").localeCompare(String(a.started_at || "")),
        );
        return { challenge: c, attempt: sorted[0] || null };
      } catch {
        return { challenge: c, attempt: null };
      }
    }),
  );
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-400">
          Evaluate how candidates actually use AI. Candidates solve real multi-file challenges with
          Claude Code / Codex in a sandbox, and you get an evidence-backed report — prompting, exploration,
          tool usage, debugging, testing, and final code quality.
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <p className="text-sm text-gray-400">Challenges</p>
          <p className="mt-1 text-3xl font-bold text-white">{challenges.length}</p>
          <Link href="/challenges" className="mt-2 inline-block text-sm text-cobaltlt hover:underline">Browse challenges →</Link>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <p className="text-sm text-gray-400">Dual scoring</p>
          <p className="mt-1 text-lg font-semibold text-white">40% functional · 60% AI collaboration</p>
          <p className="mt-1 text-sm text-gray-500">JUnit / TAP / FS_SCORE for the code; recorded process, with evidence, for the collaboration.</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <p className="text-sm text-gray-400">New assessment</p>
          <p className="mt-1 text-lg font-semibold text-white">HackerRank-style projects, AI-native</p>
          <Link href="/challenges/new" className="mt-2 inline-block rounded-lg bg-vermillion px-4 py-2 text-sm font-semibold text-white hover:bg-vermilliondeep">Create a challenge</Link>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-white">Latest challenges</h2>
        {cards.map(({ challenge: c, attempt }: any) => (
          <article key={c.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
            <h3 className="font-semibold text-white">{c.title}</h3>
            <p className="text-sm text-gray-400">{c.type} · {c.difficulty} · {c.score} pts · {c.recommended_time_minutes} min</p>
            <p className="mt-2 text-sm text-gray-300">{c.problem_description}</p>
            {attempt ? (
              <Link className="mt-2 inline-block text-sm text-cobaltlt hover:underline" href={`/attempts/${attempt.id}`}>Open attempt view →</Link>
            ) : (
              <p className="mt-2 text-xs text-gray-500">No attempts yet — create one from the Challenges page.</p>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
