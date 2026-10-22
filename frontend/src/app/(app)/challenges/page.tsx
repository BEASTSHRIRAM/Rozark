import Link from "next/link";
import { fetchAttempts, fetchChallenges } from "@/lib/api";
import NewAttemptForm from "@/components/NewAttemptForm";

export default async function ChallengesPage() {
  const challenges = await fetchChallenges();
  // Resolve each challenge's most recent attempt so the link targets a real
  // attempt id. Linking the challenge id produced dead /attempts/<challenge>
  // routes. Challenges with no attempts get a muted note instead of a link.
  const cards = await Promise.all(
    challenges.map(async (c: any) => {
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
    <div className="space-y-4">
      <h1 className="text-3xl font-bold tracking-tight text-white">Challenges</h1>
      {cards.map(({ challenge: c, attempt }: any) => (
        <article key={c.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="font-semibold">{c.title}</h2>
          <p className="text-sm text-gray-400">{c.type} · {c.difficulty} · {c.score} pts · {c.recommended_time_minutes} min</p>
          <p className="mt-2 text-sm">{c.problem_description}</p>
          {attempt ? (
            <Link className="mt-2 inline-block text-cobaltlt text-sm" href={`/attempts/${attempt.id}`}>Open attempt view →</Link>
          ) : (
            <p className="mt-2 text-xs text-gray-500">No attempts yet — create the first one below.</p>
          )}
          <NewAttemptForm challengeId={c.id} />
        </article>
      ))}
    </div>
  );
}
