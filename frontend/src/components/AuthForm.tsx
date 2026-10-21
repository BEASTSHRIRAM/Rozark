"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { login, signup } from "@/lib/auth";
import { Logo } from "@/components/nav";
import { MiniVisual } from "@/components/LandingVisuals";

const inputCls =
  "w-full rounded-lg border border-sand bg-card px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/35 outline-none transition focus:border-vermillion focus:ring-2 focus:ring-vermillion/25";

function AuthShell({ children, heading, sub }: { children: React.ReactNode; heading: string; sub: string }) {
  return (
    <div className="grid min-h-screen bg-paper lg:grid-cols-2">
      {/* visual side — ink panel carrying paper product cards */}
      <div className="relative hidden overflow-hidden bg-ink lg:block">
        <div className="relative flex h-full flex-col justify-between p-10">
          <Logo dark />
          <div className="space-y-4">
            <p className="max-w-md font-display text-[28px] font-semibold leading-snug text-paper">
              The candidate report your hiring team will actually read.
            </p>
            <div className="grid max-w-md gap-3">
              <MiniVisual kind="agent" />
              <MiniVisual kind="tests" />
            </div>
            <p className="font-mono text-[11px] text-paper/50">every score links to the session event behind it</p>
          </div>
          <p className="text-xs text-paper/50">Open-source · MIT · github.com/BEASTSHRIRAM/Rozark</p>
        </div>
      </div>
      {/* form side — paper */}
      <div className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden"><Logo /></div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">{heading}</h1>
          <p className="mt-2 text-sm text-ink/60">{sub}</p>
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
        <label className="block text-sm font-medium text-ink/80">Work email
          <input className={`${inputCls} mt-1.5`} type="email" required autoComplete="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block text-sm font-medium text-ink/80">Password
          <input className={`${inputCls} mt-1.5`} type="password" required autoComplete="current-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="rounded-lg border border-vermillion/40 bg-vermillion/10 px-3 py-2 text-sm text-vermilliondeep">{error}</p>}
        <button disabled={busy} className="cta-lift w-full rounded-full bg-vermillion px-4 py-2.5 text-sm font-semibold text-white hover:bg-vermilliondeep disabled:opacity-50">
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>
      <div className="mt-5 rounded-lg border border-sand bg-card px-3.5 py-3 text-sm text-ink/75">
        <p className="font-medium text-ink">Try the demo account</p>
        <p className="mt-0.5 font-mono text-xs text-ink/50">demo@rozark.dev · demo1234</p>
        <button
          className="link-sweep mt-2 text-sm font-medium text-cobalt"
          onClick={() => { setEmail("demo@rozark.dev"); setPassword("demo1234"); }}
        >
          Fill demo credentials →
        </button>
      </div>
      <p className="mt-6 text-sm text-ink/55">
        New to Rozark? <Link href="/signup" className="link-sweep font-medium text-cobalt">Create an account</Link>
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
        <label className="block text-sm font-medium text-ink/80">Company name
          <input className={`${inputCls} mt-1.5`} required autoComplete="organization" placeholder="Acme Technologies" value={company} onChange={(e) => setCompany(e.target.value)} />
        </label>
        <label className="block text-sm font-medium text-ink/80">Your name
          <input className={`${inputCls} mt-1.5`} required autoComplete="name" placeholder="Asha Kulkarni" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block text-sm font-medium text-ink/80">Work email
          <input className={`${inputCls} mt-1.5`} type="email" required autoComplete="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block text-sm font-medium text-ink/80">Password
          <input className={`${inputCls} mt-1.5`} type="password" required minLength={8} autoComplete="new-password" placeholder="At least 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="rounded-lg border border-vermillion/40 bg-vermillion/10 px-3 py-2 text-sm text-vermilliondeep">{error}</p>}
        <button disabled={busy} className="cta-lift w-full rounded-full bg-vermillion px-4 py-2.5 text-sm font-semibold text-white hover:bg-vermilliondeep disabled:opacity-50">
          {busy ? "Creating account…" : "Create account"}
        </button>
      </form>
      <p className="mt-6 text-sm text-ink/55">
        Already have an account? <Link href="/login" className="link-sweep font-medium text-cobalt">Log in</Link>
      </p>
    </AuthShell>
  );
}
