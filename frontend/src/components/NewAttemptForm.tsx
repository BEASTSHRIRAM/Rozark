"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createAttempt } from "@/lib/api";

// Inline "New attempt" form on a challenge card: creates a real attempt via
// POST /attempts and routes the candidate to that attempt's lobby.
export default function NewAttemptForm({ challengeId }: { challengeId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Candidate name is required."); return; }
    setBusy(true); setError("");
    try {
      const a = await createAttempt({ challenge_id: challengeId, candidate_name: name.trim(), candidate_email: email.trim() });
      router.push(`/attempts/${a.id}/lobby`);
    } catch {
      setError("Could not create the attempt — is the backend running on :8000?");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-2 border-t border-gray-800 pt-3">
      <label className="flex flex-col gap-1 text-xs text-gray-400">
        Candidate name
        <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Jane Doe" className="rounded border border-gray-600 bg-gray-900 px-2 py-1.5 text-sm text-gray-100" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-gray-400">
        Candidate email
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="jane@example.com" className="rounded border border-gray-600 bg-gray-900 px-2 py-1.5 text-sm text-gray-100" />
      </label>
      <button type="submit" disabled={busy} className="rounded bg-vermilliondeep px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Creating…" : "New attempt"}</button>
      {error && <p className="w-full text-xs text-red-300">{error}</p>}
    </form>
  );
}
