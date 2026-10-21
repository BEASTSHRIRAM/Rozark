"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchMe, getToken, logout, type AuthUser } from "@/lib/auth";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-black text-white shadow-lg shadow-indigo-950/50">R</span>
      <span className="text-lg font-bold tracking-tight text-white">Rozark</span>
    </Link>
  );
}

function useAuthUser() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!getToken()) { setReady(true); return; }
    fetchMe().then((u) => { setUser(u); setReady(true); });
  }, []);
  return { user, ready };
}

/** Marketing-site nav (landing page). */
export function SiteNav() {
  const { user, ready } = useAuthUser();
  const router = useRouter();
  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-[#070b16]/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5">
        <Logo />
        <nav className="hidden items-center gap-7 text-sm text-gray-300 md:flex">
          <a href="#product" className="transition hover:text-white">Product</a>
          <a href="#how" className="transition hover:text-white">How it works</a>
          <a href="#report" className="transition hover:text-white">Report</a>
          <a href="#pricing" className="transition hover:text-white">Pricing</a>
          <a href="https://github.com/BEASTSHRIRAM/Rozark" target="_blank" rel="noreferrer" className="transition hover:text-white">GitHub</a>
        </nav>
        <div className="flex items-center gap-3">
          {ready && user ? (
            <>
              <Link href="/dashboard" className="hidden text-sm text-gray-300 transition hover:text-white sm:block">{user.company_name}</Link>
              <Link href="/dashboard" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500">Open dashboard</Link>
            </>
          ) : (
            <>
              <Link href="/login" className="text-sm font-medium text-gray-200 transition hover:text-white">Log in</Link>
              <button onClick={() => router.push("/signup")} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500">Get started</button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/** App shell nav (dashboard, challenges, wizard, attempt, report). */
export function AppNav() {
  const { user } = useAuthUser();
  const router = useRouter();
  const links = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/challenges", label: "Challenges" },
    { href: "/challenges/new", label: "Create challenge" },
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-[#070b16]/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5">
        <div className="flex items-center gap-8">
          <Logo href="/dashboard" />
          <nav className="hidden items-center gap-6 text-sm text-gray-300 md:flex">
            {links.map((l) => (<Link key={l.href} href={l.href} className="transition hover:text-white">{l.label}</Link>))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {user && (
            <span className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/5 py-1 pl-1 pr-3 text-xs text-gray-200 sm:flex">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-[11px] font-bold text-white">{user.name.charAt(0).toUpperCase()}</span>
              {user.name} · {user.company_name}
            </span>
          )}
          <button
            onClick={() => { logout(); router.push("/login"); }}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-gray-200 transition hover:bg-white/5"
          >
            Log out
          </button>
        </div>
      </div>
    </header>
  );
}

/** Client-side route guard: app pages require a stored token.
 *  Labelled honestly — the API still validates tokens server-side. */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (!getToken()) { router.replace("/login"); return; }
    setOk(true);
  }, [router]);
  if (!ok) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-gray-400">
        Checking your session…
      </div>
    );
  }
  return <>{children}</>;
}
