"use client";
import { useEffect, useState } from "react";
import { fetchPublicTests } from "@/lib/api";
import type { PublicTests } from "@/lib/types";

// Public-tests checklist (HackerRank test-panel pattern): named PUBLIC
// tests from the latest scoring run with ✓/✗ status; failures expand to
// the Expected-vs-Received detail. Hidden tests appear ONLY as a locked
// count line — the backend never sends their names or assertions.
// Polls every 15s so a fresh "Run tests"/score run shows up here.

const STATUS_ICON: Record<string, string> = { passed: "✓", failed: "✗", error: "✗", skipped: "–" };
const STATUS_CLASS: Record<string, string> = {
  passed: "text-sage",
  failed: "text-red-400",
  error: "text-red-400",
  skipped: "text-gray-500",
};

export default function PublicTestsPanel({ attemptId }: { attemptId: string }) {
  const [data, setData] = useState<PublicTests | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try { const d = await fetchPublicTests(attemptId); if (alive) setData(d); }
      catch { /* keep last */ }
    };
    poll();
    const iv = setInterval(poll, 15000);
    return () => { alive = false; clearInterval(iv); };
  }, [attemptId]);

  const passed = data?.tests.filter((t) => t.status === "passed").length ?? 0;
  const failed = (data?.tests.length ?? 0) - passed;

  return (
    <section className="space-y-2 rounded border border-gray-700 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Tests</h2>
        {data?.run_id ? (
          <span className="text-[11px] text-gray-500">
            <span className="text-sage">{passed} passed</span>
            {failed ? <span className="text-red-400"> · {failed} failed</span> : null}
          </span>
        ) : null}
      </div>
      {!data || !data.run_id ? (
        <p className="text-sm text-gray-500">No scoring run yet — run the tests from the terminal or submit to see the named public tests here. Hidden tests stay locked either way.</p>
      ) : (
        <ul className="space-y-1">
          {data.tests.map((t) => {
            const isFail = t.status === "failed" || t.status === "error";
            const expanded = !!open[t.name];
            return (
              <li key={t.name} className="rounded border border-gray-800 bg-gray-900 px-2.5 py-1.5">
                <button
                  onClick={() => isFail && setOpen((o) => ({ ...o, [t.name]: !o[t.name] }))}
                  className={`flex w-full items-center gap-2 text-left text-sm ${isFail ? "cursor-pointer" : "cursor-default"}`}
                >
                  <span className={`font-mono ${STATUS_CLASS[t.status] ?? "text-gray-400"}`}>{STATUS_ICON[t.status] ?? "?"}</span>
                  <span className="font-mono text-[13px] text-gray-200">{t.name}</span>
                  {isFail ? <span className="ml-auto text-[11px] text-gray-500">{expanded ? "hide" : "expected vs received"}</span> : null}
                </button>
                {isFail && expanded ? (
                  <div className="mt-1.5 space-y-1 border-t border-gray-800 pt-1.5 font-mono text-xs">
                    {t.expected ? <p><span className="text-gray-500">Expected: </span><span className="text-gray-200">{t.expected}</span></p> : null}
                    {t.received ? <p><span className="text-gray-500">Received: </span><span className="text-red-300">{t.received}</span></p> : null}
                    {!t.expected && !t.received && t.message ? <p className="text-gray-300">{t.message}</p> : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {data && data.hidden.total > 0 ? (
        <p className="text-[11px] text-gray-500">🔒 {data.hidden.total} hidden test{data.hidden.total === 1 ? "" : "s"} — {data.hidden.passed} passing. Names and details stay hidden; they run in full at submit.</p>
      ) : null}
    </section>
  );
}
