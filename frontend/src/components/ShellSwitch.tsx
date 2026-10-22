"use client";
import { usePathname } from "next/navigation";
import { AppNav, AuthGuard } from "@/components/nav";
import { TestShell } from "@/components/TestShell";

// Shell switch for the whole (app) route group. Candidate surfaces —
// the attempt workspace, lobby and submitted pages — render in the
// dedicated TEST SHELL (TestShell): slim wordmark bar, zero recruiter
// UI, so a student mid-test can never see or reach the recruiter
// product. Everything else (dashboard, challenges, wizard, reports,
// and the attempt REPLAY — a recruiter review surface) keeps the full
// recruiter AppNav shell, unchanged.
//
// (Implemented as a pathname switch inside the group layout rather
// than a separate route group so the change is pure file updates —
// no route files move, URLs are untouched.)
const CANDIDATE_ROUTE = /^\/attempts\/[^/]+(?:\/(?:lobby|submitted))?\/?$/;

export function ShellSwitch({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname && CANDIDATE_ROUTE.test(pathname)) {
    return <TestShell>{children}</TestShell>;
  }
  return (
    <div className="min-h-screen bg-inkdeep text-paper">
      <AppNav />
      <main className="mx-auto max-w-7xl px-5 py-8">
        <AuthGuard>{children}</AuthGuard>
      </main>
    </div>
  );
}
