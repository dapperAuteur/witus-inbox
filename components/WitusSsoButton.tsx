"use client";

import { useCallback, useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import {
  SILENT_SSO_TIMEOUT_MS,
  SSO_ATTEMPT_STORAGE_KEY,
  continueAsLabel,
  parseSilentSsoIdentity,
  silentSsoDecision,
  type SsoIdentity,
} from "@/lib/silent-sso";

/**
 * "Sign in with WitUS", plus the silent "Continue as <name>" check on top of it.
 *
 * WHAT THE VISITOR SEES. The email form is already on screen; nothing here
 * delays it. The button reads "Sign in with WitUS" from the first paint. If the
 * probe comes back with a live WitUS session it becomes "Continue as <name>".
 * If the probe fails, times out, is blocked by the browser's third-party-cookie
 * rules, or the IdP does not answer, nothing changes and nothing is said — a
 * failed silent check has to be completely invisible.
 *
 * `enabled` and `silentCheckUrl` are BOTH resolved on the server (see
 * app/auth/sign-in/page.tsx) and are never derived here. With no
 * WITUS_OIDC_CLIENT_ID the provider is not registered in lib/auth.ts, so the
 * button would send BAM to a NextAuth error page — the component renders
 * nothing instead, and makes no request to accounts.witus.online either.
 *
 * The name on the button is DISPLAY COPY, NEVER A CREDENTIAL. Clicking runs the
 * real OIDC code flow, which is the only thing that establishes identity.
 */
export function WitusSsoButton({
  enabled,
  silentCheckUrl,
}: {
  /** Server-resolved: is the `witus` OIDC provider actually registered? */
  enabled: boolean;
  /** Server-resolved IdP probe URL, or null when ecosystem SSO is unconfigured. */
  silentCheckUrl: string | null;
}) {
  const [pending, setPending] = useState(false);
  const [identity, setIdentity] = useState<SsoIdentity | null>(null);

  useEffect(() => {
    const endpoint = enabled ? silentCheckUrl : null;
    const decision = silentSsoDecision({
      endpoint,
      search: window.location.search,
      attempted: readAttempted(),
    });
    // `!endpoint` is already implied by decision.attempt; repeating it keeps the
    // narrowing the compiler's rather than a cast that outlives the invariant.
    if (!decision.attempt || !endpoint) return;

    // Abort rather than hang. A probe still in flight after the visitor has
    // moved on leaks their attention, not just a socket.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SILENT_SSO_TIMEOUT_MS);
    let live = true;

    // `credentials: "include"` is the entire mechanism: the answer depends on
    // the IdP's OWN cookie, which is third-party from here. Browsers that
    // partition or block third-party cookies (Safari ITP, Firefox Total Cookie
    // Protection) answer "nobody", and that is a supported outcome — the
    // visitor simply keeps the ordinary button.
    fetch(endpoint, {
      credentials: "include",
      mode: "cors",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (!live) return;
        const found = parseSilentSsoIdentity(payload);
        if (found) setIdentity(found);
      })
      .catch(() => {
        // Invisible on purpose: network error, CORS refusal, abort, non-JSON
        // body — all the same non-event.
      })
      .finally(() => clearTimeout(timer));

    return () => {
      live = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, silentCheckUrl]);

  const start = useCallback(() => {
    setPending(true);
    // THE LOOP GUARD, written BEFORE the redirect, never after the return.
    // Without it a stale IdP session gives: probe says "Continue as X" -> click
    // -> the IdP cannot finish -> back to sign-in -> probe says "Continue as X"
    // -> forever. With it, one attempt per tab; the next render offers the plain
    // button and the email form, which always work.
    writeAttempted();
    const callbackUrl =
      new URLSearchParams(window.location.search).get("callbackUrl") ?? "/inbox";
    void signIn("witus", { callbackUrl });
  }, []);

  if (!enabled) return null;

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        disabled={pending}
        onClick={start}
      >
        {pending ? "Redirecting…" : continueAsLabel(identity)}
      </Button>
      {/* Always in the DOM so the label change is announced when it happens, and
          silent (and invisible) when the probe found nothing. */}
      <p
        role="status"
        aria-live="polite"
        className={
          identity
            ? "mt-2 text-center text-xs text-slate-500 dark:text-slate-400"
            : "sr-only"
        }
      >
        {identity ? "Not you? Use the email form above." : ""}
      </p>
    </>
  );
}

/**
 * sessionStorage throws outright in some privacy modes, so both halves are
 * wrapped. A browser that cannot remember the attempt still gets the other half
 * of the guard: a `?sso=tried` marker on the URL, which silentSsoDecision reads.
 */
function readAttempted(): boolean {
  try {
    return window.sessionStorage.getItem(SSO_ATTEMPT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeAttempted(): void {
  try {
    window.sessionStorage.setItem(SSO_ATTEMPT_STORAGE_KEY, "1");
  } catch {
    // No storage, no marker. The query-param half still applies.
  }
}
