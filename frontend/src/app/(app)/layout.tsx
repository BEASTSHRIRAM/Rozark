import { AppNav, AuthGuard } from "@/components/nav";

// App shell for the logged-in product (dashboard, challenges, wizard,
// attempt workspace, reports). The interior stays a warm-ink workspace
// (inkdeep) under the paper design system — vermillion/cobalt accents
// match the landing. AuthGuard is a client-side guard — it redirects to
// /login when no token is stored; the API still validates tokens
// server-side.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-inkdeep text-paper">
      <AppNav />
      <main className="mx-auto max-w-7xl px-5 py-8">
        <AuthGuard>{children}</AuthGuard>
      </main>
    </div>
  );
}
