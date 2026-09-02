import Link from "next/link";
import { WaitlistJoinForm } from "@/components/WaitlistJoinForm";

// Where a refused sign-in lands. Public — proxy.ts matches only /inbox and the two
// API prefixes, and this page must be reachable by exactly the people who have no
// session.
//
// WHY IT EXISTS. WitUS Inbox is a single-admin operator console: lib/auth.ts
// completes a sign-in only for ADMIN_EMAIL. Before this page, someone who signed in
// with a perfectly good WitUS account hit NextAuth's raw
// /api/auth/error?error=AccessDenied — no explanation, no link back, nowhere to go.
// BAM (2026-09-01): "route them to waitlist and ask them if they want to join
// waitlist". lib/auth.ts points `pages.error` at /auth/sign-in, which forwards
// AccessDenied here (lib/auth-error.ts).
//
// IT RECORDS SOMETHING REAL. The join button posts to POST /api/waitlist, which
// writes a row into the `submission` table that BAM triages at /inbox like any
// other ecosystem submission. It is not a form that quietly drops what it is given.
//
// `?from=sso` only chooses the wording. It is a query param a stranger can type, so
// it gates nothing.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Request access",
};

export default async function WaitlistPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params?.from;
  const from = Array.isArray(raw) ? raw[0] : raw;
  const refused = from === "sso";

  return (
    <main id="main" className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {refused ? "That account doesn't have access here" : "Request access"}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {refused
              ? "Your WitUS sign-in worked — the account just isn't on the list for this app. WitUS Inbox is the operator console the ecosystem's forms submit into, and it's single-admin today. Want to be added to the list?"
              : "WitUS Inbox is the operator console the ecosystem's forms submit into, and it's single-admin today. Leave your email to be added to the list."}
          </p>
        </header>

        <WaitlistJoinForm />

        <p className="text-xs text-slate-500 dark:text-slate-500">
          <Link
            href="/auth/sign-in"
            className="underline underline-offset-4 hover:text-sky-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
