"use client";

import { useId, useState } from "react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import {
  SIGN_OUT_EVERYWHERE_HELP,
  SIGN_OUT_EVERYWHERE_LABEL,
  SIGN_OUT_LABEL,
  SIGNING_OUT_LABEL,
  signOutEverywhere,
  signOutHere,
  type SignOutEffects,
} from "@/lib/silent-sso";

/**
 * Sign-out controls (BAM, 2026-10-29, witus task 128 option (b)).
 *
 * - `SignOutButton` ("Sign out") ends ONLY the Inbox's NextAuth session and goes
 *   to /auth/sign-in. It never navigates to the IdP and its label never changes
 *   (shared UI rule: the header Sign out control is never renamed or removed).
 * - `SignOutEverywhereButton` ("Sign out of WitUS everywhere") is a secondary
 *   control that also ends the shared accounts.witus.online session. It renders
 *   only when `endSessionUrl` is non-null.
 *
 * `endSessionUrl` is resolved on the SERVER (lib/env.ts, getWitusEndSessionUrl)
 * and already carries `client_id`; it is null when this app is not a configured
 * OIDC client. A client component must not read the raw env.
 */

// `redirect: false` so NextAuth does not navigate before we do. A full
// navigation (not a router push) follows: the everywhere flow leaves this
// origin, and every page under /inbox is gated by proxy.ts anyway.
const browserEffects: SignOutEffects = {
  endLocalSession: () => signOut({ redirect: false }),
  navigate: (url) => window.location.assign(url),
};

export function SignOutButton({ className }: { className?: string }) {
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    await signOutHere(browserEffects);
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={className}
      disabled={pending}
      onClick={() => void onClick()}
    >
      {pending ? SIGNING_OUT_LABEL : SIGN_OUT_LABEL}
    </Button>
  );
}

export function SignOutEverywhereButton({
  endSessionUrl = null,
  className,
}: {
  endSessionUrl?: string | null;
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  const helpId = useId();

  if (!endSessionUrl) return null;
  const url = endSessionUrl;

  async function onClick() {
    setPending(true);
    // ORDER IS THE SAFETY PROPERTY: signOutEverywhere destroys the local
    // session FIRST, then hands off to the IdP (see lib/silent-sso.ts).
    await signOutEverywhere(url, window.location.origin, browserEffects);
  }

  return (
    <div className={className}>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        aria-describedby={helpId}
        disabled={pending}
        onClick={() => void onClick()}
      >
        {pending ? SIGNING_OUT_LABEL : SIGN_OUT_EVERYWHERE_LABEL}
      </Button>
      <p id={helpId} className="mt-1 max-w-xs text-xs text-slate-600 dark:text-slate-400">
        {SIGN_OUT_EVERYWHERE_HELP}
      </p>
    </div>
  );
}
