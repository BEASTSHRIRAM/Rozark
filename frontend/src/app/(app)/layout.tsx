import { ShellSwitch } from "@/components/ShellSwitch";

// One route group, two shells (see components/ShellSwitch.tsx):
// recruiter surfaces (dashboard, challenges, wizard, reports, replay)
// get the full AppNav shell; candidate surfaces (attempt workspace,
// lobby, submitted) get the minimal TEST SHELL so a candidate never
// sees recruiter nav. The interior stays a warm-ink workspace
// (inkdeep) under the paper design system — vermillion/cobalt accents
// match the landing. AuthGuard is a client-side guard — it redirects
// to /login when no token is stored; the API still validates tokens
// server-side.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <ShellSwitch>{children}</ShellSwitch>;
}
