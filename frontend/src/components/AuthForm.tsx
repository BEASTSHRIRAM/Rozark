"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { login, signup } from "@/lib/auth";
import { Logo } from "@/components/nav";
import { MiniVisual } from "@/components/LandingVisuals";

const inputCls =
  "w-full rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-gray-500 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/30";

function AuthShell({ children, heading, sub }: { children: React.ReactNode; heading: string; sub: string }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* visual side */}
      <div className="relative hidden overflow-hidden bg-[#0a0f22] lg:block">
        <div className="aurora aurora-a bg-fuchsia-600/30" />
        <div className="aurora aurora-b bg-cyan-500/25" />
        <div className="aurora aurora-c bg-amber-500/20" />
        <div className="relative flex h-full flex-col justify-between p-10">
          <Logo />
          <div className="space-y-4">
            <p className="max-w-md text-2xl font-bold leading-snug text-white">
              The candidate report your hiring team will actually read.
            </p>
            <div className="grid max-w-md gap-3">
              <MiniVisual kind="agent" />
              <MiniVisual kind="tests" />
            </div>
            <p className="font-mono text-[11px] text-gray-500">every score links to the session event behind it</p>
          </div>
          <p className="text-xs text-gray-500">Open-source · MIT · github.com/BEASTSHRIRAM/Rozark</p>
        </div>
      </div>
      {/* form side */}
      <div className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden"><Logo /></div>
          <h1 className="text-3xl font-bold tracking-tight text-white">{heading}</h1>
          <p className="mt-2 text-sm text-gray-400">{sub}</p>
          <div className="mt-8">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await login(email, password);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed. Is the backend running on :8000?");
      setBusy(false);
    }
  }
  return (
    <AuthShell heading="Welcome back" sub="Log in to your Rozark workspace.">
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block text-sm text-gray-300">Work email
          <input className={`${inputCls} mt-1.5`} type="email" required autoComplete="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block text-sm text-gray-300">Password
          <input className={`${inputCls} mt-1.5`} type="password" required autoComplete="current-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}
        <button disabled={busy} className="w-full rounded-lg bg-gradient-to-r from-indigo-600 to-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>
      <div className="mt-5 rounded-lg border border-white/10 bg-white/[0.03] px-3.5 py-3 text-sm text-gray-300">
        <p className="font-medium text-gray-100">Try the demo account</p>
        <p className="mt-0.5 font-mono text-xs text-gray-400">demo@rozark.dev · demo1234</p>
        <button
          className="mt-2 text-sm text-indigo-300 hover:underline"
          onClick={() => { setEmail("demo@rozark.dev"); setPassword("demo1234"); }}
        >
          Fill demo credentials →
        </button>
      </div>
      <p className="mt-6 text-sm text-gray-400">
        New to Rozark? <Link href="/signup" className="font-medium text-indigo-300 hover:underline">Create an account</Link>
      </p>
    </AuthShell>
  );
}

export function SignupForm() {
  const router = useRouter();
  const [company, setCompany] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await signup(company, name, email, password);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed. Is the backend running on :8000?");
      setBusy(false);
    }
  }
  return (
    <AuthShell heading="Create your workspace" sub="Free and open-source. Set up your first AI-native assessment in minutes.">
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block text-sm text-gray-300">Company name
          <input className={`${inputCls} mt-1.5`} required autoComplete="organization" placeholder="Acme Technologies" value={company} onChange={(e) => setCompany(e.target.value)} />
        </label>
        <label className="block text-sm text-gray-300">Your name
          <input className={`${inputCls} mt-1.5`} required autoComplete="name" placeholder="Asha Kulkarni" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block text-sm text-gray-300">Work email
          <input className={`${inputCls} mt-1.5`} type="email" required autoComplete="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block text-sm text-gray-300">Password
          <input className={`${inputCls} mt-1.5`} type="password" required minLength={8} autoComplete="new-password" placeholder="At least 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}
        <button disabled={busy} className="w-full rounded-lg bg-gradient-to-r from-indigo-600 to-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
          {busy ? "Creating account…" : "Create account"}
        </button>
      </form>
      <p className="mt-6 text-sm text-gray-400">
        Already have an account? <Link href="/login" className="font-medium text-indigo-300 hover:underline">Log in</Link>
      </p>
    </AuthShell>
  );
}
