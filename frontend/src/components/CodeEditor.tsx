"use client";
import { useEffect, useRef, useState } from "react";

// VS Code-style editor background that sits in the ink palette (#171310 is
// a step lighter than inkdeep so the editor reads as its own surface).
export const EDITOR_BG = "#171310";

type MonacoModule = {
  editor: {
    defineTheme: (name: string, theme: Record<string, unknown>) => void;
  };
};

type EditorInstance = {
  addCommand: (keybinding: number, handler: () => void) => void;
  onDidChangeCursorPosition: (cb: (e: { position: { lineNumber: number; column: number } }) => void) => void;
  getPosition: () => { lineNumber: number; column: number } | null;
};

// Code editor for the attempt workspace.
// Primary: Monaco via @monaco-editor/react (real dependency, loads the
// Monaco AMD bundle client-side). If the Monaco module or its CDN bundle
// cannot load (offline), we fall back to a plain textarea editor with line
// numbers and a mono font — the fallback is honest, never labelled Monaco.

type MonacoEditorComponent = React.ComponentType<Record<string, unknown>>;

function languageFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    py: "python", ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    json: "json", md: "markdown", html: "html", css: "css", sh: "shell", bash: "shell",
    yml: "yaml", yaml: "yaml", toml: "ini", txt: "plaintext", sql: "sql", go: "go",
    java: "java", rs: "rust", c: "c", cpp: "cpp",
  };
  return map[ext] || "plaintext";
}

export default function CodeEditor({ path, value, readOnly, onChange, onSave, onCursor }: {
  path: string;
  value: string;
  readOnly: boolean;
  onChange: (v: string) => void;
  onSave: () => void;
  onCursor?: (line: number, col: number) => void;
}) {
  const [Monaco, setMonaco] = useState<MonacoEditorComponent | null>(null);
  const [failed, setFailed] = useState(false);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const cursorRef = useRef(onCursor);
  cursorRef.current = onCursor;

  useEffect(() => {
    let alive = true;
    import("@monaco-editor/react")
      .then((m) => { if (alive) setMonaco(() => m.default as unknown as MonacoEditorComponent); })
      .catch(() => { if (alive) setFailed(true); });
    // If the editor bundle hasn't arrived in 10s (offline CDN), fall back.
    const t = setTimeout(() => { if (alive) setFailed((f) => f || Monaco === null); }, 10000);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!Monaco || failed) {
    // Fallback editor — textarea + line numbers, Ctrl/Cmd+S saves.
    const lines = value.split("\n").length;
    const reportCursor = (ta: HTMLTextAreaElement) => {
      if (!cursorRef.current) return;
      const upto = ta.value.slice(0, ta.selectionStart).split("\n");
      cursorRef.current(upto.length, upto[upto.length - 1].length + 1);
    };
    return (
      <div className="flex h-full min-h-[320px]" style={{ background: EDITOR_BG }}>
        <pre aria-hidden className="select-none overflow-hidden py-3 pl-3 pr-2 text-right font-mono text-xs leading-6 text-stonewarm">
          {Array.from({ length: lines }, (_, i) => i + 1).join("\n")}
        </pre>
        <textarea
          value={value}
          readOnly={readOnly}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          onSelect={(e) => reportCursor(e.currentTarget)}
          onClick={(e) => reportCursor(e.currentTarget)}
          onKeyUp={(e) => reportCursor(e.currentTarget)}
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); onSave(); } }}
          className="h-full min-h-[320px] w-full resize-none bg-transparent p-3 font-mono text-xs leading-6 text-gray-200 outline-none"
          aria-label={`Editor for ${path} (plain text fallback)`}
        />
      </div>
    );
  }

  return (
    <div className="h-full min-h-[320px]" style={{ background: EDITOR_BG }}>
      <Monaco
        path={path}
        language={languageFor(path)}
        theme="rozark-ink"
        value={value}
        beforeMount={(monaco: MonacoModule) => {
          monaco.editor.defineTheme("rozark-ink", {
            base: "vs-dark",
            inherit: true,
            rules: [],
            colors: {
              "editor.background": EDITOR_BG,
              "editor.lineHighlightBackground": "#221C15",
              "editorLineNumber.foreground": "#8A7F6A",
              "editorLineNumber.activeForeground": "#FAF6EF",
              "editorCursor.foreground": "#E8490F",
              "editor.selectionBackground": "#2B3FE055",
              "editorIndentGuide.background1": "#2A241C",
              "editorIndentGuide.activeBackground1": "#4A4033",
            },
          });
        }}
        onChange={(v: string | undefined) => onChange(v ?? "")}
        onMount={(editor: EditorInstance, monaco: { KeyMod: { CtrlCmd: number }; KeyCode: { KeyS: number } }) => {
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current());
          if (cursorRef.current) {
            const pos = editor.getPosition();
            if (pos) cursorRef.current(pos.lineNumber, pos.column);
            editor.onDidChangeCursorPosition((e) => cursorRef.current?.(e.position.lineNumber, e.position.column));
          }
        }}
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 12.5,
          lineHeight: 20,
          scrollBeyondLastLine: false,
          padding: { top: 10 },
          renderLineHighlight: "line",
        }}
        loading={<p className="p-3 font-mono text-xs text-gray-500">Loading editor…</p>}
      />
    </div>
  );
}
