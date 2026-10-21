import "./globals.css";
import { Fraunces, Inter } from "next/font/google";

// Editorial type pairing: Fraunces (display serif) + Inter (UI sans).
const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700", "900"],
  style: ["normal", "italic"],
});
const sans = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata = {
  title: "Rozark — AI-native technical assessments",
  description:
    "Rozark evaluates how candidates actually use AI coding agents: real codebase, real ticket, Claude Code / Codex in a sandbox, and an evidence-backed report. Open-source and self-hostable.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body className="bg-paper font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
