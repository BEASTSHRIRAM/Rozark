"use client";
import { useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import { startSandbox, stopSandbox, type SandboxSession } from "@/lib/api";

// A REAL terminal into the attempt's sandbox workspace.
// - "Start sandbox" calls POST /attempts/{id}/sandbox/start, which
//   materialises an isolated workspace (copy of the challenge starter,
//   git-initialised) and starts the recorder watcher on the backend.
// - The xterm below connects to the backend websocket /ws/sandbox/{id}:
//   a real PTY running bash in that workspace. Keystrokes and resizes go
//   up, output streams down, and the backend taps BOTH directions into
//   the attempt's event log as terminal_cmd / terminal_output events.
// - If the backend is unreachable or the session is frozen, the panel
//   says so — it never fakes a working terminal.

const WS_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/^http/, "ws");

type State = "idle" | "starting" | "live" | "offline" | "closed";

export default function SandboxTerminal({ attemptId, submitted }: { attemptId: string; submitted: boolean }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<State>(submitted ? "closed" : "idle");
  const [session, setSession] = useState<SandboxSession | null>(null);
  const [error, setError] = useState("");

  async function start() {
    setState("starting");
    setError("");
    try {
      const info = await startSandbox(attemptId);
      setSession(info);
      connect(info);
    } catch {
      setState("offline");
      setError("Could not start the sandbox — is the backend running on :8000?");
    }
  }

  async function connect(info: SandboxSession) {
    // xterm is loaded client-side only (it needs a real DOM/canvas).
    const { Terminal } = await import("@xterm/xterm");
    const { FitAddon } = await import("@xterm/addon-fit");
    if (!mountRef.current) return;
    mountRef.current.innerHTML = "";
    const term = new Terminal({
      cursorBlink: true, fontSize: 12.5, convertEol: false,
      theme: { background: "#0b0f1c", foreground: "#d1d5db", cursor: "#818cf8" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(mountRef.current);
    fit.fit();

    const ws = new WebSocket(`${WS_BASE}${info.ws_url}`);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;
    const sendResize = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };
    ws.onopen = () => { setState("live"); sendResize(); term.focus(); };
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        try {
          const obj = JSON.parse(ev.data);
          if (obj?.type === "error") {
            term.writeln(`\r\n[sandbox] ${obj.message}`);
            return;
          }
        } catch { /* not a control frame — it's terminal text */ }
        term.write(ev.data);
      } else {
        term.write(new Uint8Array(ev.data as ArrayBuffer));
      }
    };
    ws.onclose = () => {
      setState((s) => (s === "live" ? "closed" : s));
    };
    ws.onerror = () => setState("offline");
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });
    const onResize = () => { fit.fit(); sendResize(); };
    window.addEventListener("resize", onResize);
    term.onResize(() => sendResize());
    // Stash cleanup on the element so stop()/unmount can tear down.
    (mountRef.current as unknown as { _rzCleanup?: () => void })._rzCleanup = () => {
      window.removeEventListener("resize", onResize);
      ws.close();
      term.dispose();
    };
  }

  async function stop() {
    (mountRef.current as unknown as { _rzCleanup?: () => void })?._rzCleanup?.();
    wsRef.current = null;
    try { setSession(await stopSandbox(attemptId)); } catch { /* session display is best-effort */ }
    setState("closed");
  }

  useEffect(() => {
    return () => {
      (mountRef.current as unknown as { _rzCleanup?: () => void })?._rzCleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {state === "idle" && (
          <button onClick={start} className="rounded-lg bg-indigo-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-600">
            ▶ Start sandbox session
          </button>
        )}
        {state === "starting" && <span className="text-xs text-gray-400">Starting sandbox…</span>}
        {state === "live" && (
          <>
            <span className="rounded bg-emerald-500/10 px-2 py-1 font-mono text-[11px] text-emerald-300">
              ● live · backend: {session?.backend || "local"}{session?.expires_at ? ` · expires ${new Date(session.expires_at).toLocaleTimeString()}` : ""}
            </span>
            <button onClick={stop} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-gray-200 transition hover:bg-white/5">Stop session</button>
          </>
        )}
        {state === "offline" && (
          <span className="rounded bg-red-500/10 px-2 py-1 text-xs text-red-300">
            Backend unreachable — the terminal is offline. Start the backend on :8000 and retry.
            <button onClick={start} className="ml-2 underline underline-offset-2">Retry</button>
          </span>
        )}
        {state === "closed" && (
          <span className="rounded bg-white/5 px-2 py-1 font-mono text-[11px] text-gray-400">
            {submitted ? "session frozen by submit — workspace sealed into the report" : "session stopped — PTY closed, final git snapshot recorded"}
          </span>
        )}
        {session?.backend_note && <span className="text-[11px] text-amber-300/90">{session.backend_note}</span>}
        {error && <span className="text-[11px] text-red-300">{error}</span>}
      </div>
      <div className="min-h-[220px] flex-1 overflow-hidden rounded-lg border border-white/10 bg-[#0b0f1c] p-1.5">
        {state === "idle" || state === "starting" ? (
          <div className="flex h-full min-h-[200px] flex-col items-start justify-center gap-2 p-3 font-mono text-[11px] leading-5 text-gray-500">
            <p>$ — no sandbox session yet</p>
            <p className="text-gray-600">
              Start creates an isolated workspace (copy of the challenge starter project, git-initialised),
              opens a real shell in it, and records every command + output, file edit, and git snapshot
              into this attempt&apos;s event log.
            </p>
          </div>
        ) : (
          <div ref={mountRef} className="h-full min-h-[200px] w-full" />
        )}
      </div>
      <p className="mt-1.5 text-[10px] text-gray-600">
        Reconnects are manual (the Start button) — a dropped socket never silently reconnects you to a
        different shell. The in-sandbox coding agent + budget proxy are the next increment; this terminal
        is you, in the workspace, fully recorded.
      </p>
    </div>
  );
}
