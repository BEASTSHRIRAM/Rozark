import Link from "next/link";
import { SiteNav } from "@/components/nav";
import { MockAssessmentWindow, MiniVisual } from "@/components/LandingVisuals";
import LandingMotion from "@/components/LandingMotion";
import { demoReport, phaseColor } from "@/lib/demoReport";

// Rozark landing page — the product's front door.
// Copy and design are Rozark's own; the structure (real-task assessment,
// evidence report) follows the category pattern set by tools like
// HirePrise and HackerRank Projects.

const comparison: { label: string; dsa: string; rozark: string }[] = [
  { label: "The task", dsa: "Solve a known algorithm problem", rozark: "Fix a bug, add a feature, or improve a design in an existing codebase" },
  { label: "Starting point", dsa: "An empty editor", rozark: "A real, working project — set up the way your team's is" },
  { label: "The brief", dsa: "Input and expected output", rozark: "A product brief or a customer ticket, with business rules and acceptance criteria" },
  { label: "AI", dsa: "Blocked — and any model still solves it in seconds", rozark: "Allowed, expected, and measured. Real agents: Claude Code & Codex, in a sandbox" },
  { label: "Grading", dsa: "Test cases pass or fail", rozark: "Hidden suite + code quality + a full session replay of how they used AI" },
  { label: "Tells you", dsa: "Whether the fundamentals are there", rozark: "Whether they can ship production work — and how well they drive AI while doing it" },
];

const features = [
  {
    kind: "brief" as const,
    title: "A real brief, in a real project",
    body: "The task arrives the way work does: a ticket with business rules and acceptance criteria, landing in a working repository — not an empty editor. Reading it carefully is part of the test.",
  },
  {
    kind: "agent" as const,
    title: "AI in the sandbox, measured",
    body: "Candidates drive a real coding agent — Claude Code first, Codex next — inside an isolated container with a token budget enforced at the proxy. Rozark records what they asked, when, and how much of the output they rewrote by hand.",
  },
  {
    kind: "tests" as const,
    title: "Visible and hidden tests",
    body: "Sample tests run live in the workspace, so candidates get the same feedback loop they'd get at their desk. A hidden suite grades the final submission.",
  },
];

export default function LandingPage() {
  const r = demoReport;
  const totalPrompts = r.promptsByPhase.reduce((a, p) => a + p.count, 0);
  return (
    <div className="min-h-screen bg-[#070b16] text-gray-100">
      <LandingMotion />
      <SiteNav />

      {/* ------------------------------------------------ Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(99,102,241,0.16),transparent_70%)]" />
        <div className="aurora aurora-a bg-fuchsia-600/25" />
        <div className="aurora aurora-b bg-cyan-500/20" />
        <div className="aurora aurora-c bg-amber-500/15" />
        <div className="relative mx-auto max-w-7xl px-5 pb-16 pt-16 text-center md:pt-24">
          <span className="inline-flex items-center gap-2 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-200">
            Open-source · AI-native technical assessments
          </span>
          <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-extrabold leading-[1.08] tracking-tight text-white md:text-6xl">
            {["Hiring", "for", "the", "AI", "era", "means", "testing", "how", "they", "build"].map((w) => (
              <span key={w} className="gs-hero-word inline-block">{w}&nbsp;</span>
            ))}
            <span className="gs-hero-word inline-block bg-gradient-to-r from-indigo-300 via-fuchsia-300 to-amber-200 bg-clip-text text-transparent">with AI</span>
          </h1>
          <p className="gs-hero-sub mx-auto mt-5 max-w-2xl text-base leading-7 text-gray-300 md:text-lg">
            Rozark gives candidates a real codebase and a real ticket, lets them drive Claude Code or Codex in a
            sandbox, records the whole session — and hands you an evidence-backed report on whether they can
            actually do the job.
          </p>
          <div className="gs-hero-ctas mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link data-magnetic href="/signup" className="inline-block rounded-lg bg-gradient-to-r from-indigo-600 via-fuchsia-600 to-amber-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-fuchsia-950/50 transition hover:opacity-95">
              Start assessing — free
            </Link>
            <a href="#report" className="rounded-lg border border-white/15 px-6 py-3 text-sm font-semibold text-gray-100 transition hover:bg-white/5">
              See a candidate report
            </a>
          </div>
          <p className="mt-4 text-xs text-gray-500">Self-host it in minutes · No credit card · Built for startups hiring interns &amp; freshers in India</p>

          <div className="gs-hero-visual relative mx-auto mt-12 max-w-5xl text-left">
            <div className="pointer-events-none absolute -inset-3 rounded-[28px] bg-gradient-to-r from-indigo-600/40 via-fuchsia-500/40 to-cyan-400/40 blur-2xl" />
            <div className="relative"><MockAssessmentWindow /></div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ Signals marquee */}
      <div className="overflow-hidden border-y border-white/5 bg-white/[0.02] py-3.5" aria-hidden="true">
        <div className="marquee-track items-center gap-8 pr-8">
          {[0, 1].map((copy) => (
            <div key={copy} className="flex items-center gap-8">
              {[
                ["Prompting", "bg-violet-400"], ["Exploration", "bg-cyan-300"], ["Debugging", "bg-amber-400"],
                ["Testing", "bg-emerald-400"], ["Tool use", "bg-fuchsia-400"], ["Planning", "bg-violet-400"],
                ["Pushback", "bg-rose-400"], ["Code quality", "bg-sky-300"], ["Verification", "bg-emerald-300"],
                ["Session replay", "bg-indigo-300"],
              ].map(([word, dot]) => (
                <span key={word} className="flex items-center gap-8 whitespace-nowrap text-sm font-semibold uppercase tracking-[0.2em] text-gray-300">
                  {word} <span className={`h-2 w-2 rounded-full ${dot}`} />
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ------------------------------------------------ Proof strip */}
      <section className="border-y border-white/5 bg-white/[0.02]">
        <div className="mx-auto grid max-w-7xl gap-4 px-5 py-8 text-center sm:grid-cols-3">
          <p className="text-sm text-gray-300"><strong className="block text-xl text-white">Real codebase, real ticket</strong>not a puzzle on a whiteboard</p>
          <p className="text-sm text-gray-300"><strong className="block text-xl text-white">Every session recorded</strong>prompts, edits, test runs, tokens — one event log</p>
          <p className="text-sm text-gray-300"><strong className="block text-xl text-white">Open-source &amp; self-hosted</strong>your candidate data never leaves your infra</p>
        </div>
      </section>

      {/* ------------------------------------------------ Comparison */}
      <section id="product" className="mx-auto max-w-7xl scroll-mt-24 px-5 py-20">
        <h2 className="text-center text-3xl font-bold tracking-tight text-white">Test how they think <em className="not-italic text-indigo-300">and</em> how they build</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-gray-400">
          Run a traditional DSA round for fundamentals if you like. Rozark's engineering round tells you the rest.
        </p>
        <div data-reveal className="mx-auto mt-10 max-w-4xl overflow-hidden rounded-2xl border border-white/10">
          <div className="grid grid-cols-[110px_1fr_1fr] bg-white/[0.04] text-sm font-semibold text-white md:grid-cols-[160px_1fr_1fr]">
            <span className="p-4" />
            <span className="p-4 text-gray-400">DSA round</span>
            <span className="p-4 text-indigo-200">Rozark engineering round</span>
          </div>
          {comparison.map((row, i) => (
            <div key={row.label} className={`grid grid-cols-[110px_1fr_1fr] text-sm md:grid-cols-[160px_1fr_1fr] ${i % 2 ? "bg-white/[0.015]" : ""}`}>
              <span className="p-4 font-medium text-gray-400">{row.label}</span>
              <span className="p-4 text-gray-500">{row.dsa}</span>
              <span className="p-4 text-gray-100">{row.rozark}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------ How it works */}
      <section id="how" className="scroll-mt-24 border-y border-white/5 bg-white/[0.015]">
        <div className="mx-auto max-w-7xl px-5 py-20">
          <h2 className="text-3xl font-bold tracking-tight text-white">A real project, a clear brief, a set time limit</h2>
          <p className="mt-3 max-w-2xl text-gray-400">
            The candidate opens a working repository, reads the brief the way work actually arrives, and ships a
            change a reviewer could merge. Here is what makes the signal different:
          </p>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {features.map((f) => (
              <article data-reveal data-tilt key={f.title} className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[#0a0f1f] p-5">
                <MiniVisual kind={f.kind} />
                <h3 className="text-lg font-semibold text-white">{f.title}</h3>
                <p className="text-sm leading-6 text-gray-400">{f.body}</p>
              </article>
            ))}
          </div>
          <ol className="mt-12 grid gap-4 text-sm md:grid-cols-4">
            {[
              ["1 · Create", "Pick or clone a project, set install / run / test commands and hidden tests."],
              ["2 · Invite", "Candidates get one link: one sandbox, one timer, one token budget."],
              ["3 · They build", "Real agent, real repo. Everything is recorded to a single event log."],
              ["4 · You review", "Fit score + evidence report + full replay. Decide in minutes."],
            ].map(([t, b]) => (
              <li data-reveal key={t} className="rounded-xl border border-white/10 p-4">
                <p className="font-semibold text-white">{t}</p>
                <p className="mt-1 leading-6 text-gray-400">{b}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ------------------------------------------------ Report */}
      <section id="report" className="mx-auto max-w-7xl scroll-mt-24 px-5 py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-white">The candidate report</h2>
            <p className="mt-3 max-w-2xl text-gray-400">
              Not a black-box score. Every signal points at the exact prompt, commit, or failing test behind it —
              so a reviewer can verify the judgement in minutes.
            </p>
          </div>
          <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-xs text-amber-200">Sample report — Rozark demo data</span>
        </div>

        <div data-reveal className="mt-10 grid gap-4 md:grid-cols-4">
          <div data-tilt className="rounded-2xl border-2 border-fuchsia-500/50 bg-[#0a0f1f] p-5 text-center shadow-lg shadow-fuchsia-950/40">
            <p className="text-sm text-gray-400">Fit for the role</p>
            <p className="mt-1 text-5xl font-extrabold"><span data-count={r.fit} className="bg-gradient-to-r from-indigo-300 to-fuchsia-300 bg-clip-text text-transparent">{r.fit}</span><span className="text-fuchsia-300">%</span></p>
            <p className="mt-2 text-xs text-gray-500">scored against the role, requirement by requirement</p>
          </div>
          <div data-tilt className="rounded-2xl border border-emerald-400/25 bg-[#0a0f1f] p-5">
            <p className="text-sm text-gray-400">Hire signals / concerns</p>
            <p className="mt-1 text-3xl font-bold text-white">{r.signals.length} / {r.concerns.length}</p>
            <p className="mt-2 text-xs text-gray-500">each one links to a prompt, commit, or failing test in the session</p>
          </div>
          <div data-tilt className="rounded-2xl border border-violet-400/25 bg-[#0a0f1f] p-5">
            <p className="text-sm text-gray-400">Prompts, phase-tagged</p>
            <p className="mt-1 text-3xl font-bold text-white"><span data-count={totalPrompts}>{totalPrompts}</span></p>
            <div className="mt-3 space-y-1.5">
              {r.promptsByPhase.map((p) => (
                <div key={p.phase} className="flex items-center gap-2 text-xs text-gray-400">
                  <span className="w-16 capitalize">{p.phase}</span>
                  <span className="h-1.5 flex-1 rounded bg-white/5"><span className={`gs-bar block h-1.5 rounded ${phaseColor[p.phase]}`} style={{ width: `${(p.count / totalPrompts) * 100}%` }} /></span>
                  <span>{p.count}</span>
                </div>
              ))}
            </div>
          </div>
          <div data-tilt className="rounded-2xl border border-cyan-400/25 bg-[#0a0f1f] p-5">
            <p className="text-sm text-gray-400">Tokens used</p>
            <p className="mt-1 text-3xl font-bold text-white"><span data-count={Math.round(r.tokens.used / 1000)}>{Math.round(r.tokens.used / 1000)}</span>k <span className="text-base text-gray-500">/ {(r.tokens.cap / 1000).toFixed(0)}k budget</span></p>
            <p className="mt-2 text-xs text-gray-500">planning · building · debugging, split by phase — active time {r.metrics.activeTime} of 30m</p>
          </div>
        </div>

        <div data-reveal className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-emerald-500/20 bg-[#0a0f1f] p-5">
            <h3 className="font-semibold text-emerald-300">Why this candidate scored well</h3>
            <ul className="mt-3 space-y-3 text-sm leading-6 text-gray-300">
              {r.signals.map((s) => (<li key={s.text}>✓ {s.text} <span className="font-mono text-xs text-indigo-300">({s.evidence})</span></li>))}
            </ul>
          </div>
          <div className="rounded-2xl border border-white/10 bg-indigo-950/30 p-5">
            <h3 className="font-semibold text-white">Reviewer summary</h3>
            <p className="mt-3 text-sm leading-6 text-gray-200">{r.summary}</p>
            <Link href="/reports/demo" className="mt-4 inline-block text-sm font-medium text-indigo-300 underline-offset-4 hover:underline">
              Open the full sample report →
            </Link>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ Open source */}
      <section className="border-y border-white/5 bg-white/[0.015]">
        <div data-reveal className="mx-auto grid max-w-7xl items-center gap-8 px-5 py-20 md:grid-cols-2">
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-white">Open-source, like the tools it measures</h2>
            <p className="mt-4 leading-7 text-gray-400">
              Rozark follows the Frappe philosophy: the platform is free, self-hostable, and inspectable. Run it on
              your own infrastructure, read exactly how every score is computed, and keep candidate session data
              on your servers — not ours. Companies can adopt it the way they adopt ERPNext: install it, make it
              theirs, contribute back.
            </p>
            <div className="mt-6 flex gap-3">
              <a href="https://github.com/BEASTSHRIRAM/Rozark" target="_blank" rel="noreferrer" className="rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-gray-900 transition hover:bg-gray-200">★ Star on GitHub</a>
              <Link href="/signup" className="rounded-lg border border-white/15 px-5 py-2.5 text-sm font-semibold text-gray-100 transition hover:bg-white/5">Self-host Rozark</Link>
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-[#0d1326] p-5 font-mono text-[12px] leading-6 text-gray-300">
            <p className="text-gray-500"># run the whole thing yourself</p>
            <p><span className="text-violet-300">git</span> clone https://github.com/BEASTSHRIRAM/Rozark</p>
            <p><span className="text-violet-300">cd</span> Rozark &amp;&amp; docker compose up --build</p>
            <p className="text-gray-500"># backend :8000 · frontend :3000 · postgres included</p>
            <p className="mt-3"><span className="text-emerald-300">✓</span> scoring rubric is code, not a black box <span className="text-gray-500">(docs/SCORING_RUBRIC.md)</span></p>
            <p><span className="text-emerald-300">✓</span> event log schema is public <span className="text-gray-500">(docs/EVENT_LOG_SCHEMA.md)</span></p>
            <p><span className="text-emerald-300">✓</span> MIT licensed</p>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ Pricing */}
      <section id="pricing" className="mx-auto max-w-7xl scroll-mt-24 px-5 py-20">
        <h2 className="text-center text-3xl font-bold tracking-tight text-white">Pricing, in the open</h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-gray-400">The platform is free software. You only ever pay for the AI tokens your candidates spend — capped per session, by you.</p>
        <div data-reveal className="mx-auto mt-10 grid max-w-4xl gap-5 md:grid-cols-3">
          {[
            { name: "Open-source", price: "₹0", blurb: "Self-host the full platform. Unlimited challenges, candidates, and reports.", cta: "Get the code", href: "https://github.com/BEASTSHRIRAM/Rozark", hot: false },
            { name: "Team", price: "Coming soon", blurb: "Hosted Rozark for startups: managed sandboxes, token budgets, and team review workflows.", cta: "Join the waitlist", href: "/signup", hot: true },
            { name: "Campus", price: "Coming soon", blurb: "Bulk intern & fresher screening for hiring drives, with cohort-level reports.", cta: "Talk to us", href: "/signup", hot: false },
          ].map((t) => (
            <div key={t.name} className={`rounded-2xl border p-6 ${t.hot ? "border-indigo-500/60 bg-indigo-950/25" : "border-white/10 bg-[#0a0f1f]"}`}>
              <p className="text-sm font-medium text-gray-400">{t.name}</p>
              <p className="mt-2 text-3xl font-extrabold text-white">{t.price}</p>
              <p className="mt-3 text-sm leading-6 text-gray-400">{t.blurb}</p>
              <a href={t.href} className={`mt-5 inline-block rounded-lg px-4 py-2 text-sm font-semibold ${t.hot ? "bg-indigo-600 text-white hover:bg-indigo-500" : "border border-white/15 text-gray-100 hover:bg-white/5"}`}>{t.cta}</a>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------ Final CTA + footer */}
      <section className="border-t border-white/5">
        <div className="mx-auto max-w-7xl px-5 py-16 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white">See the engineering round in action</h2>
          <p className="mx-auto mt-3 max-w-xl text-gray-400">Create an account, run the sample challenge, and read a real evidence report — in about ten minutes.</p>
          <Link data-magnetic href="/signup" className="mt-7 inline-block rounded-lg bg-gradient-to-r from-indigo-600 via-fuchsia-600 to-amber-500 px-7 py-3 text-sm font-semibold text-white transition hover:opacity-95">Get started free</Link>
        </div>
        <footer className="border-t border-white/5">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-sm text-gray-500">
            <p><span className="font-semibold text-gray-300">Rozark</span> — AI-native technical assessments. Open-source under MIT.</p>
            <nav className="flex gap-5">
              <a href="#product" className="hover:text-gray-300">Product</a>
              <a href="#how" className="hover:text-gray-300">How it works</a>
              <a href="#report" className="hover:text-gray-300">Report</a>
              <a href="https://github.com/BEASTSHRIRAM/Rozark" target="_blank" rel="noreferrer" className="hover:text-gray-300">GitHub</a>
              <Link href="/login" className="hover:text-gray-300">Log in</Link>
            </nav>
          </div>
        </footer>
      </section>
    </div>
  );
}
