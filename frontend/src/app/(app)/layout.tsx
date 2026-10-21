import { AppNav, AuthGuard } from "@/components/nav";

// App shell for the logged-in product (dashboard, challenges, wizard,
// attempt workspace, reports). AuthGuard is a client-side guard — it
// redirects to /login when no token is stored; the API still validates
// tokens server-side.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#070b16]">
      <AppNav />
      <main className="mx-auto max-w-7xl px-5 py-8">
        <AuthGuard>{children}</AuthGuard>
      </main>
    </div>
  );
}
