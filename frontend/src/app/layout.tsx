import "./globals.css";

export const metadata = {
  title: "Rozark — AI-native technical assessments",
  description:
    "Rozark evaluates how candidates actually use AI coding agents: real codebase, real ticket, Claude Code / Codex in a sandbox, and an evidence-backed report. Open-source and self-hostable.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#070b16] text-gray-100 antialiased">{children}</body>
    </html>
  );
}
