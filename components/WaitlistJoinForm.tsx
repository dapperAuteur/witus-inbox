"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * The "yes, add me" half of /auth/waitlist.
 *
 * IT POSTS TO POST /api/waitlist, which writes a real row into the `submission`
 * table — the same queue BAM triages at /inbox, the same one every sibling
 * product's forms land in. Nothing here records anything on its own, and it never
 * claims success unless the API said ok: a form that pretends to remember an
 * address it dropped is worse than no form.
 *
 * WHY IT ASKS FOR THE EMAIL. This page is reached after NextAuth refused a
 * sign-in, and NextAuth hands the error page a CODE — never the address that was
 * refused. Prefilling would mean guessing. Asking is the honest version, and it
 * also lets someone put a different address on the list than the one they signed
 * in with.
 */
export function WaitlistJoinForm() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!normalized || pending) return;
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: normalized }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Request failed (${res.status}). Please try again.`);
        setPending(false);
        return;
      }
      setJoined(true);
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (joined) {
    return (
      <section
        role="status"
        className="rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm dark:border-emerald-700 dark:bg-emerald-950"
      >
        <p className="font-semibold text-slate-900 dark:text-slate-100">
          You&rsquo;re on the list
        </p>
        <p className="mt-1 text-slate-700 dark:text-slate-300">
          Your request was recorded. We&rsquo;ll email you if access opens up — nothing
          else needed from you.
        </p>
      </section>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="waitlist-email" className="block text-sm font-medium">
          Email
        </label>
        <Input
          id="waitlist-email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={pending}
          aria-describedby={error ? "waitlist-error" : undefined}
          aria-invalid={error ? true : undefined}
        />
      </div>

      {error ? (
        <p id="waitlist-error" role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending || email.length === 0} className="w-full">
        {pending ? "Adding you…" : "Add me to the list"}
      </Button>
      <p className="text-xs text-slate-500 dark:text-slate-500">
        We&rsquo;ll only use it to email you about access.
      </p>
    </form>
  );
}
