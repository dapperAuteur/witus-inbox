import { SignInForm } from "@/components/SignInForm";
import { WitusSsoButton } from "@/components/WitusSsoButton";
import { getWitusSilentSsoEndpoint, isWitusOidcConfigured } from "@/lib/env";

// Server component so the ecosystem-SSO endpoints are resolved here, from env,
// and handed down as props — a client component must never read the raw env.
// force-dynamic because that resolution has to happen per request rather than
// being frozen into a prerendered page at build time.
export const dynamic = "force-dynamic";

export default function SignInPage() {
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

        <SignInForm />

        {witusEnabled ? (
          <>
            <p className="text-center text-xs uppercase tracking-wide text-slate-500">or</p>
            <WitusSsoButton enabled={witusEnabled} silentCheckUrl={silentCheckUrl} />
          </>
        ) : null}
      </div>
    </main>
  );
}
