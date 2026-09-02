"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";

/**
 * Sign out of the Inbox — and, when ecosystem SSO is configured, out of every
 * WitUS app in this browser (BAM's decision, 2026-08-30: "signout signs out of
 * every app"). Ending only the local NextAuth session would leave the shared
 * accounts.witus.online session alive, so signing out and coming back would
 * offer to sign you straight back in via "Continue as ...", which reads as a
 * broken logout.
 *
 * `endSessionUrl` is resolved on the SERVER (lib/env.ts, getWitusEndSessionUrl)
 * and already carries `client_id`; it is null when this app is not a configured
 * OIDC client, in which case sign-out stays purely local. A client component
 * must not read the raw env.
 */
export function SignOutButton({
  endSessionUrl = null,
  className,
}: {
  endSessionUrl?: string | null;
  className?: string;
}) {
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    // ORDER IS THE SAFETY PROPERTY. Destroy the local session FIRST. If the IdP
    // is unreachable, refuses the logout, or the redirect never completes, BAM
    // is still signed out HERE. Handing off first would turn any IdP failure
    // into "I clicked sign out and I'm still signed in".
    // `redirect: false` so NextAuth does not navigate before we do.
    await signOut({ redirect: false }).catch(() => {
      // NextAuth already cleared the cookie in the common failure modes; the
      // navigation below is what matters either way, so never trap someone in a
      // session they asked to leave.
    });

    if (endSessionUrl) {
      // TRAILING SLASH IS REQUIRED. better-auth exact-matches
      // post_logout_redirect_uri against the client's registered redirectUrls,
      // and the IdP registry (gemini/witus lib/identity/clients.ts) registers
      // `origin + "/"`. Drop the slash and the IdP returns invalid_request.
      //
      // Derived from window.location.origin rather than a hardcoded host so the
      // one external value this app asserts stays its own origin. NOTE: only the
      // production origin (https://inbox.witus.online/) is registered with the
      // IdP, so a Vercel preview deployment gets refused at this step — the
      // local session is already gone by then, which is the point of the order.
      const back = `${window.location.origin}/`;
      // A full navigation, not a router push: this leaves our origin.
      // `&`, not `?`: endSessionUrl already carries client_id.
      window.location.assign(
        `${endSessionUrl}&post_logout_redirect_uri=${encodeURIComponent(back)}`
      );
      return;
    }

    // Local-only sign-out. A full navigation rather than router.refresh(): every
    // page under /inbox is gated by proxy.ts, so re-rendering in place would
    // just bounce through the middleware anyway.
    window.location.assign("/auth/sign-in");
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
      {pending ? "Signing out…" : endSessionUrl ? "Sign out of WitUS" : "Sign out"}
    </Button>
  );
}
