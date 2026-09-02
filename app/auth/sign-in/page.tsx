import { redirect } from "next/navigation";
import { SignInForm } from "@/components/SignInForm";
import { WitusSsoButton } from "@/components/WitusSsoButton";
import { authErrorAction, errorCodeFromSearchParams } from "@/lib/auth-error";
import {
  WITUS_SHOW_CONTINUE_AS,
  getWitusSilentSsoEndpoint,
  isWitusOidcConfigured,
} from "@/lib/env";

// Server component so the ecosystem-SSO endpoints are resolved here, from env,
// and handed down as props — a client component must never read the raw env.
// force-dynamic because that resolution has to happen per request rather than
// being frozen into a prerendered page at build time.
//
// THIS PAGE IS ALSO THE FAILURE SURFACE. lib/auth.ts sets
// `pages.error = "/auth/sign-in"`, so every NextAuth sign-in failure comes back
// here with an `?error=` code instead of landing on the raw /api/auth/error page
// (no message, no link back — a wall). ONE url receives every code that reaches
// it, so the code has to be read and branched on: AccessDenied (the admin gate
// refused this WitUS account) is sent on to /auth/waitlist, while Verification (an
// expired magic link) gets a "send a fresh one" notice and the email flow stays
// intact. The mapping lives in lib/auth-error.ts, pinned by lib/auth-error.test.ts.
//
// THE "Continue as <name>" PROBE IS OFF HERE, deliberately — see
// WITUS_SHOW_CONTINUE_AS in lib/env.ts for why an admin-gated app must not offer a
// personalized label it may refuse thirty seconds later.
export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const action = authErrorAction(errorCodeFromSearchParams(await searchParams));

  // A refused non-admin never sees this page — they are routed to the waitlist and
  // asked whether they want to join (BAM, 2026-09-01).
  if (action?.kind === "redirect") redirect(action.to);

  // Both null/false unless WITUS_OIDC_CLIENT_ID is set. With no OIDC client the
  // `witus` provider is not registered in lib/auth.ts, so the button would land
  // on a NextAuth error page; it stays dark instead, and no request is made to
  // accounts.witus.online at all.
  const witusEnabled = isWitusOidcConfigured();
  const silentCheckUrl = getWitusSilentSsoEndpoint();

  return (
    <main id="main" className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in to WitUS Inbox</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Enter the admin email address. A single-use sign-in link will be emailed to you.
          </p>
        </header>

        {action?.kind === "notice" ? (
          <section
            role="alert"
            className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-700 dark:bg-amber-950"
          >
            <p className="font-semibold text-slate-900 dark:text-slate-100">{action.title}</p>
            <p className="mt-1 text-slate-700 dark:text-slate-300">{action.body}</p>
          </section>
        ) : null}

        <SignInForm />

        {witusEnabled ? (
          <>
            <p className="text-center text-xs uppercase tracking-wide text-slate-500">or</p>
            <WitusSsoButton
              enabled={witusEnabled}
              silentCheckUrl={silentCheckUrl}
              // OFF on this admin-gated app. Not a deletion — see
              // WITUS_SHOW_CONTINUE_AS. With `false` the component makes no
              // request to the IdP at all and the button keeps its plain label.
              showContinueAs={WITUS_SHOW_CONTINUE_AS}
            />
          </>
        ) : null}
      </div>
    </main>
  );
}
