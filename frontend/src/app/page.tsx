import Link from "next/link";
import { SiteNav } from "@/components/nav";
import { MockAssessmentWindow, MiniVisual } from "@/components/LandingVisuals";
import LandingMotion from "@/components/LandingMotion";
import { demoReport, phaseColor } from "@/lib/demoReport";

// Rozark landing page — "ink on paper": warm paper, editorial type,
// vermillion as the one leading accent, cobalt only in small doses.
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

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-3 font-mono text-[11px] font-medium uppercase tracking-[0.25em] text-vermillion">
      <span className="gs-rule inline-block h-px w-10 bg-vermillion" />
      {children}
    </p>
  );
}

export default function LandingPage() {
  const r = demoReport;
  const totalPrompts = r.promptsByPhase.reduce((a, p) => a + p.count, 0);
  return (
    <div className="min-h-screen bg-paper text-ink">
      <LandingMotion />
      <SiteNav />

      {/* ------------------------------------------------ Hero */}
      <section className="relative overflow-hidden">
        <div className="relative mx-auto max-w-7xl px-5 pb-14 pt-14 md:pt-20">
          <Eyebrow>Open-source · AI-native technical assessments</Eyebrow>
          <h1 className="mt-6 max-w-4xl font-display text-[42px] font-semibold leading-[1.04] tracking-tight md:text-7xl">
            {["Hiring", "for", "the", "AI", "era", "means", "testing", "how", "they", "build"].map((w) => (
              <span key={w} className="gs-hero-word inline-block">{w}&nbsp;</span>
            ))}
            <span className="gs-hero-word inline-block font-display italic text-vermillion">with&nbsp;AI.</span>
          </h1>
          <p className="gs-hero-sub mt-6 max-w-2xl text-base leading-7 text-ink/70 md:text-lg md:leading-8">
            Rozark gives candidates a real codebase and a real ticket, lets them drive Claude Code or Codex in a
            sandbox, records the whole session — and hands you an evidence-backed report on whether they can
            actually do the job.
          </p>
          <div className="gs-hero-ctas mt-9 flex flex-wrap items-center gap-3">
            <Link href="/signup" className="cta-lift inline-block rounded-lg bg-vermillion px-6 py-3 text-sm font-semibold text-white hover:bg-vermilliondeep">
              Start assessing — free
            </Link>
            <a href="#report" className="cta-lift inline-block rounded-lg border border-ink/25 px-6 py-3 text-sm font-semibold text-ink hover:bg-ink hover:text-paper">
              See a candidate report
            </a>
          </div>
          <p className="mt-4 text-xs text-stonewarm">Self-host it in minutes · No credit card · Built for startups hiring interns &amp; freshers in India</p>

          <div className="gs-hero-visual relative mx-auto mt-12 max-w-5xl">
            <MockAssessmentWindow />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ Ink marquee */}
      <div className="overflow-hidden bg-ink py-3.5" aria-hidden="true">
        <div className="marquee-track items-center gap-8 pr-8">
          {[0, 1].map((copy) => (
            <div key={copy} className="flex items-center gap-8">
              {["Prompting", "Exploration", "Debugging", "Testing", "Tool use", "Planning", "Pushback", "Code quality", "Verification", "Session replay"].map((word) => (
                <span key={word} className="flex items-center gap-8 whitespace-nowrap font-display text-sm font-semibold uppercase tracking-[0.22em] text-paper">
                  {word} <span className="text-vermillion">✳</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ------------------------------------------------ Proof strip */}
      <section className="border-b border-sand">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 sm:grid-cols-3">
          <p className="text-sm leading-6 text-ink/70">
            <strong className="block font-display text-4xl font-semibold text-ink"><span data-count={60}>60</span><span className="text-vermillion">%</span></strong>
            of the score is how they work with AI — prompting, verifying, pushing back
          </p>
          <p className="text-sm leading-6 text-ink/70">
            <strong className="block font-display text-4xl font-semibold text-ink"><span data-count={100}>100</span><span className="text-vermillion">k</span></strong>
            token budget per session, enforced at the proxy — not trusted, capped
          </p>
          <p className="text-sm leading-6 text-ink/70">
            <strong className="block font-display text-4xl font-semibold text-ink"><span data-count={3}>3</span> <span className="text-vermillion">streams</span></strong>
            terminal, files and agent — merged into one ordered, replayable event log
          </p>
        </div>
      </section>

      {/* ------------------------------------------------ Comparison */}
      <section id="product" className="mx-auto max-w-7xl scroll-mt-24 px-5 py-20">
        <div data-reveal>
          <Eyebrow>The engineering round</Eyebrow>
          <h2 className="mt-4 max-w-2xl font-display text-3xl font-semibold tracking-tight md:text-4xl">Test how they think <span className="italic text-vermillion">and</span> how they build</h2>
          <p className="mt-3 max-w-2xl leading-7 text-ink/65">
            Run a traditional DSA round for fundamentals if you like. Rozark's engineering round tells you the rest.
          </p>
        </div>
        <div data-reveal className="mx-auto mt-10 max-w-4xl overflow-hidden rounded-2xl border border-sand bg-card">
          <div className="grid grid-cols-[110px_1fr_1fr] border-b border-sand bg-parchment text-sm font-semibold md:grid-cols-[160px_1fr_1fr]">
            <span className="p-4" />
            <span className="p-4 text-ink/50">DSA round</span>
            <span className="p-4 text-vermillion">Rozark engineering round</span>
          </div>
          {comparison.map((row, i) => (
            <div key={row.label} className={`grid grid-cols-[110px_1fr_1fr] text-sm md:grid-cols-[160px_1fr_1fr] ${i % 2 ? "bg-paper" : ""} ${i < comparison.length - 1 ? "border-b border-sand/70" : ""}`}>
              <span className="p-4 font-medium text-ink/55">{row.label}</span>
              <span className="p-4 text-ink/45">{row.dsa}</span>
              <span className="p-4 text-ink/90">{row.rozark}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------ How it works */}
      <section id="how" className="scroll-mt-24 border-y border-sand bg-parchment/60">
        <div className="mx-auto max-w-7xl px-5 py-20">
          <div data-reveal>
            <Eyebrow>How it works</Eyebrow>
            <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight md:text-4xl">A real project, a clear brief, a set time limit</h2>
            <p className="mt-3 max-w-2xl leading-7 text-ink/65">
              The candidate opens a working repository, reads the brief the way work actually arrives, and ships a
              change a reviewer could merge. Here is what makes the signal different:
            </p>
          </div>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {features.map((f) => (
              <article data-reveal key={f.title} className="flex flex-col gap-4 rounded-2xl border border-sand bg-card p-5">
                <MiniVisual kind={f.kind} />
                <h3 className="font-display text-xl font-semibold text-ink">{f.title}</h3>
                <p className="text-sm leading-6 text-ink/65">{f.body}</p>
              </article>
            ))}
          </div>
          <ol className="mt-12 grid gap-4 text-sm md:grid-cols-4">
            {[
              ["Create", "Pick or clone a project, set install / run / test commands and hidden tests."],
              ["Invite", "Candidates get one link: one sandbox, one timer, one token budget."],
              ["They build", "Real agent, real repo. Everything is recorded to a single event log."],
              ["You review", "Fit score + evidence report + full replay. Decide in minutes."],
            ].map(([t, b], i) => (
              <li data-reveal key={t} className="rounded-xl border border-sand bg-card p-4">
                <p className="font-display text-lg font-semibold text-ink"><span className="mr-2 text-vermillion">{i + 1}</span>{t}</p>
                <p className="mt-1 leading-6 text-ink/65">{b}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ------------------------------------------------ Report */}
      <section id="report" className="mx-auto max-w-7xl scroll-mt-24 px-5 py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div data-reveal>
            <Eyebrow>The output</Eyebrow>
            <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight md:text-4xl">The candidate report</h2>
            <p className="mt-3 max-w-2xl leading-7 text-ink/65">
              Not a black-box score. Every signal points at the exact prompt, commit, or failing test behind it —
              so a reviewer can verify the judgement in minutes.
            </p>
          </div>
          <span className="rounded-full border border-vermillion/40 bg-vermillion/[0.07] px-3 py-1 text-xs font-medium text-vermilliondeep">Sample report — Rozark demo data</span>
        </div>

        <div data-reveal className="mt-10 grid gap-4 md:grid-cols-4">
          <div className="rounded-2xl border-2 border-vermillion bg-card p-5 text-center">
            <p className="text-sm text-ink/60">Fit for the role</p>
            <p className="mt-1 font-display text-6xl font-semibold text-ink"><span data-count={r.fit}>{r.fit}</span><span className="text-vermillion">%</span></p>
            <p className="mt-2 text-xs text-ink/50">scored against the role, requirement by requirement</p>
          </div>
          <div className="rounded-2xl border border-sand bg-card p-5">
            <p className="text-sm text-ink/60">Hire signals / concerns</p>
            <p className="mt-1 font-display text-4xl font-semibold text-ink">{r.signals.length} / {r.concerns.length}</p>
            <p className="mt-2 text-xs text-ink/50">each one links to a prompt, commit, or failing test in the session</p>
          </div>
          <div className="rounded-2xl border border-sand bg-card p-5">
            <p className="text-sm text-ink/60">Prompts, phase-tagged</p>
            <p className="mt-1 font-display text-4xl font-semibold text-ink"><span data-count={totalPrompts}>{totalPrompts}</span></p>
            <div className="mt-3 space-y-1.5">
              {r.promptsByPhase.map((p) => (
                <div key={p.phase} className="flex items-center gap-2 text-xs text-ink/60">
                  <span className="w-16 capitalize">{p.phase}</span>
                  <span className="h-1.5 flex-1 rounded bg-sand/70"><span className={`gs-bar block h-1.5 rounded ${phaseColor[p.phase]}`} style={{ width: `${(p.count / totalPrompts) * 100}%` }} /></span>
                  <span>{p.count}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-sand bg-card p-5">
            <p className="text-sm text-ink/60">Tokens used</p>
            <p className="mt-1 font-display text-4xl font-semibold text-ink"><span data-count={Math.round(r.tokens.used / 1000)}>{Math.round(r.tokens.used / 1000)}</span>k <span className="font-sans text-base text-ink/45">/ {(r.tokens.cap / 1000).toFixed(0)}k budget</span></p>
            <p className="mt-2 text-xs text-ink/50">planning · building · debugging, split by phase — active time {r.metrics.activeTime} of 30m</p>
          </div>
        </div>

        <div data-reveal className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-sand bg-card p-5">
            <h3 className="font-display text-lg font-semibold text-sage">Why this candidate scored well</h3>
            <ul className="mt-3 space-y-3 text-sm leading-6 text-ink/80">
              {r.signals.map((s) => (<li key={s.text}>✓ {s.text} <span className="font-mono text-xs text-cobalt">({s.evidence})</span></li>))}
            </ul>
          </div>
          <div className="rounded-2xl bg-ink p-5 text-paper">
            <h3 className="font-display text-lg font-semibold">Reviewer summary</h3>
            <p className="mt-3 text-sm leading-6 text-paper/85">{r.summary}</p>
            <Link href="/reports/demo" className="link-sweep mt-4 inline-block text-sm font-medium text-[#FFB59A]">
              Open the full sample report →
            </Link>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ Open source */}
      <section className="border-y border-sand bg-parchment/60">
        <div data-reveal className="mx-auto grid max-w-7xl items-center gap-8 px-5 py-20 md:grid-cols-2">
          <div>
            <Eyebrow>Open-source</Eyebrow>
            <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight md:text-4xl">Open-source, like the tools it measures</h2>
            <p className="mt-4 leading-7 text-ink/65">
              Rozark follows the Frappe philosophy: the platform is free, self-hostable, and inspectable. Run it on
              your own infrastructure, read exactly how every score is computed, and keep candidate session data
              on your servers — not ours. Companies can adopt it the way they adopt ERPNext: install it, make it
              theirs, contribute back.
            </p>
            <div className="mt-6 flex gap-3">
              <a href="https://github.com/BEASTSHRIRAM/Rozark" target="_blank" rel="noreferrer" className="cta-lift rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-paper hover:bg-vermillion">★ Star on GitHub</a>
              <Link href="/signup" className="cta-lift rounded-lg border border-ink/25 px-5 py-2.5 text-sm font-semibold text-ink hover:bg-ink hover:text-paper">Self-host Rozark</Link>
            </div>
          </div>
          <div className="rounded-2xl bg-ink p-5 font-mono text-[12px] leading-6 text-[#D8CFBB]">
            <p className="text-stonewarm"># run the whole thing yourself</p>
            <p><span className="text-[#FF8A5C]">git</span> clone https://github.com/BEASTSHRIRAM/Rozark</p>
            <p><span className="text-[#FF8A5C]">cd</span> Rozark &amp;&amp; docker compose up --build</p>
            <p className="text-stonewarm"># backend :8000 · frontend :3000 · postgres included</p>
            <p className="mt-3"><span className="text-[#8FC79B]">✓</span> scoring rubric is code, not a black box <span className="text-stonewarm">(docs/SCORING_RUBRIC.md)</span></p>
            <p><span className="text-[#8FC79B]">✓</span> event log schema is public <span className="text-stonewarm">(docs/EVENT_LOG_SCHEMA.md)</span></p>
            <p><span className="text-[#8FC79B]">✓</span> MIT licensed</p>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ Pricing */}
      <section id="pricing" className="mx-auto max-w-7xl scroll-mt-24 px-5 py-20">
        <div data-reveal className="text-center">
          <Eyebrow>Pricing</Eyebrow>
          <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight md:text-4xl">Pricing, in the open</h2>
          <p className="mx-auto mt-3 max-w-xl leading-7 text-ink/65">The platform is free software. You only ever pay for the AI tokens your candidates spend — capped per session, by you.</p>
        </div>
        <div data-reveal className="mx-auto mt-10 grid max-w-4xl gap-5 md:grid-cols-3">
          {[
            { name: "Open-source", price: "₹0", blurb: "Self-host the full platform. Unlimited challenges, candidates, and reports.", cta: "Get the code", href: "https://github.com/BEASTSHRIRAM/Rozark", hot: false },
            { name: "Team", price: "Coming soon", blurb: "Hosted Rozark for startups: managed sandboxes, token budgets, and team review workflows.", cta: "Join the waitlist", href: "/signup", hot: true },
            { name: "Campus", price: "Coming soon", blurb: "Bulk intern & fresher screening for hiring drives, with cohort-level reports.", cta: "Talk to us", href: "/signup", hot: false },
          ].map((t) => (
            <div key={t.name} className={`rounded-2xl border bg-card p-6 ${t.hot ? "border-2 border-vermillion" : "border-sand"}`}>
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-ink/50">{t.name}</p>
              <p className="mt-2 font-display text-3xl font-semibold text-ink">{t.price}</p>
              <p className="mt-3 text-sm leading-6 text-ink/65">{t.blurb}</p>
              <a href={t.href} className={`cta-lift mt-5 inline-block rounded-lg px-4 py-2 text-sm font-semibold ${t.hot ? "bg-vermillion text-white hover:bg-vermilliondeep" : "border border-ink/25 text-ink hover:bg-ink hover:text-paper"}`}>{t.cta}</a>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------ Final CTA + footer */}
      <section className="bg-ink text-paper">
        <div className="mx-auto max-w-7xl px-5 py-16 text-center">
          <h2 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">See the engineering round in action</h2>
          <p className="mx-auto mt-3 max-w-xl leading-7 text-paper/70">Create an account, run the sample challenge, and read a real evidence report — in about ten minutes.</p>
          <Link href="/signup" className="cta-lift mt-7 inline-block rounded-lg bg-vermillion px-7 py-3 text-sm font-semibold text-white hover:bg-vermilliondeep">Get started free</Link>
        </div>
        <footer className="border-t border-white/10">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-sm text-paper/55">
            <p><span className="font-display font-semibold text-paper">Rozark</span> — AI-native technical assessments. Open-source under MIT.</p>
            <nav className="flex gap-5">
              <a href="#product" className="transition hover:text-paper">Product</a>
              <a href="#how" className="transition hover:text-paper">How it works</a>
              <a href="#report" className="transition hover:text-paper">Report</a>
              <a href="https://github.com/BEASTSHRIRAM/Rozark" target="_blank" rel="noreferrer" className="transition hover:text-paper">GitHub</a>
              <Link href="/login" className="transition hover:text-paper">Log in</Link>
            </nav>
          </div>
        </footer>
      </section>
    </div>
  );
}
