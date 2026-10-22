"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AuthGuard } from "@/components/nav";
import { fetchMe, getToken } from "@/lib/auth";
import { fetchAttempt, fetchChallenge } from "@/lib/api";

// Candidate TEST SHELL — the chrome for candidate surfaces only (attempt
// workspace, lobby, submitted). Mirrors HackerRank's test-v2 shell: a slim
// bar with the Rozark wordmark + challenge title and NOTHING else. No
// recruiter sidebar/nav, no Dashboard/Challenges/Reports links, no org
// chip, no logout — a candidate inside a test can never wander into the
// recruiter product. Countdown + Submit stay in the attempt page's own
// header, where they are wired to live session state.
//
// Recruiter preview ribbon: there is no role field on AuthUser — every
// account is an org account — so "recruiter previewing" is detected as: a
// logged-in user whose email differs from the attempt's candidate_email.
// Fail-closed: if either email is unknown, no ribbon (a real candidate
// never sees it). The ribbon is the ONLY difference between the two views.
export function TestShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const attemptId = pathname?.match(/^\/attempts\/([^/]+)/)?.[1] ?? null;
  const [challengeTitle, setChallengeTitle] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!attemptId || !getToken()) return;
    (async () => {
      const attempt = await fetchAttempt(attemptId).catch(() => null);
      if (!alive || !attempt) return;
      setCandidateName(attempt.candidate_name || "");
      const challenge = await fetchChallenge(attempt.challenge_id).catch(() => null);
      if (alive && challenge) setChallengeTitle(challenge.title || "");
      const user = await fetchMe().catch(() => null);
      if (!alive || !user) return;
      const candidateEmail = (attempt.candidate_email || "").trim().toLowerCase();
      if (candidateEmail && user.email.trim().toLowerCase() !== candidateEmail) setPreview(true);
    })();
    return () => { alive = false; };
  }, [attemptId]);

  return (
    <div className="min-h-screen bg-inkdeep text-paper">
      {preview && (
        <div className="bg-vermillion px-4 py-1.5 text-center text-xs font-medium text-white">
          Preview — viewing as candidate{candidateName ? ` (${candidateName})` : ""}. This is exactly the test shell the candidate sees; you are only seeing this ribbon because you are logged in as the recruiter.
        </div>
      )}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-ink/95 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-7xl items-center gap-4 px-5">
          {/* Static wordmark — deliberately NOT a link: inside a test there
              is nowhere to navigate to. */}
          <span className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-vermillion font-display text-sm font-black text-white">R</span>
            <span className="font-display text-lg font-bold tracking-tight text-paper">Rozark</span>
          </span>
          {challengeTitle && (
            <>
              <span className="h-5 w-px bg-white/15" aria-hidden />
              <span className="truncate text-sm text-paper/75">{challengeTitle}</span>
            </>
          )}
          <span className="ml-auto hidden text-[11px] font-medium uppercase tracking-[0.14em] text-paper/45 sm:block">Assessment</span>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-5 py-8">
        <AuthGuard>{children}</AuthGuard>
      </main>
    </div>
  );
}
