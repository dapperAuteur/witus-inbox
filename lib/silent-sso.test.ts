import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LOCAL_SIGN_OUT_DESTINATION,
  SIGN_OUT_EVERYWHERE_HELP,
  SIGN_OUT_EVERYWHERE_LABEL,
  SIGN_OUT_LABEL,
  SSO_ATTEMPT_STORAGE_KEY,
  WITUS_OIDC_DISCOVERY_FALLBACK,
  continueAsLabel,
  endSessionEndpointFromDiscovery,
  endSessionRedirectUrl,
  hasAttemptMarker,
  parseSilentSsoIdentity,
  silentSsoDecision,
  signOutEverywhere,
  signOutHere,
  silentSsoEndpointFromDiscovery,
  type SignOutEffects,
} from "./silent-sso";

/**
 * Ecosystem SSO — "Continue as <name>" + the two sign-out controls.
 *
 * Pinned in order of what each would cost if it broke:
 *   1. THE GATE. With no WITUS_OIDC_CLIENT_ID, nothing may reach
 *      accounts.witus.online and no un-completable button may render.
 *   2. THE SIGN-OUT ORDER. "Sign out of WitUS everywhere" must destroy the local
 *      session BEFORE handing off to the IdP, or an IdP outage becomes "I signed
 *      out and I'm still in". Plain "Sign out" never goes to the IdP at all.
 *   3. THE REDIRECT LOOP. probe -> "Continue as X" -> click -> IdP declines ->
 *      back to sign-in -> probe. Never seen in normal use, so it is pinned here.
 *   4. INVISIBLE FAILURE. Nothing the probe returns may produce an error, a
 *      stuck spinner, or a claim about who the visitor is.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf-8");

/** Assertions about what the CODE does must not be satisfied by a comment. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ENDPOINT = "https://accounts.witus.online/api/ecosystem/session";

describe("the gate: nothing happens without a configured OIDC client", () => {
  it("refuses to probe when no endpoint was resolved, whatever else is true", () => {
    for (const endpoint of [null, undefined, ""]) {
      for (const search of ["", "?callbackUrl=/inbox", "?sso=tried"]) {
        for (const signedIn of [false, true]) {
          expect(silentSsoDecision({ endpoint, search, signedIn })).toEqual({
            attempt: false,
            skip: "not-configured",
          });
        }
      }
    }
  });

  it("derives both URLs to null from an unusable discovery URL", () => {
    for (const bad of [null, undefined, "", "not-a-url", "https://accounts.example/api/idp"]) {
      expect(silentSsoEndpointFromDiscovery(bad)).toBeNull();
      expect(endSessionEndpointFromDiscovery(bad)).toBeNull();
    }
  });

  it("keeps both features dark on the server when the client id is unset", () => {
    const env = stripComments(read("lib/env.ts"));
    // Both getters return null before touching anything else.
    expect(env).toMatch(
      /isWitusOidcConfigured\(\)[\s\S]{0,40}?return Boolean\(process\.env\.WITUS_OIDC_CLIENT_ID\)/
    );
    expect(env).toMatch(/getWitusSilentSsoEndpoint[\s\S]*?if \(!isWitusOidcConfigured\(\)\) return null;/);
    expect(env).toMatch(/getWitusEndSessionUrl[\s\S]*?if \(!clientId\) return null;/);
  });

  it("does not render the WitUS button on the sign-in page when unconfigured", () => {
    const page = stripComments(read("app/auth/sign-in/page.tsx"));
    expect(page).toContain("isWitusOidcConfigured()");
    expect(page).toMatch(/witusEnabled \? \(/);
    // The email form is outside that conditional: the path that always works.
    expect(page).toContain("<SignInForm />");
    // A client component must never read the raw env.
    const button = read("components/WitusSsoButton.tsx");
    expect(button).not.toContain("process.env");
    expect(read("components/SignOutButton.tsx")).not.toContain("process.env");
  });
});

describe("URL derivation: the IdP host is named once, in the discovery URL", () => {
  it("derives the probe endpoint from the configured discovery URL", () => {
    expect(silentSsoEndpointFromDiscovery(WITUS_OIDC_DISCOVERY_FALLBACK)).toBe(ENDPOINT);
    expect(
      silentSsoEndpointFromDiscovery(
        "https://idp.staging.example/auth/.well-known/openid-configuration"
      )
    ).toBe("https://idp.staging.example/api/ecosystem/session");
  });

  it("derives the endsession endpoint under the IdP's own basePath", () => {
    expect(endSessionEndpointFromDiscovery(WITUS_OIDC_DISCOVERY_FALLBACK)).toBe(
      "https://accounts.witus.online/api/idp/oauth2/endsession"
    );
    expect(
      endSessionEndpointFromDiscovery(
        "https://idp.staging.example/auth/.well-known/openid-configuration"
      )
    ).toBe("https://idp.staging.example/auth/oauth2/endsession");
  });

  it("names accounts.witus.online in exactly one place", () => {
    const sources = ["lib/silent-sso.ts", "lib/env.ts", "lib/auth.ts"];
    const hits = sources.flatMap((rel) =>
      stripComments(read(rel))
        .split("\n")
        .filter((line) => line.includes("accounts.witus.online"))
        .map((line) => `${rel}: ${line.trim()}`)
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain("lib/silent-sso.ts");
  });
});

describe("sign-out: plain Sign out is local-only, everywhere is separate (task 128 (b))", () => {
  const END_SESSION =
    "https://accounts.witus.online/api/idp/oauth2/endsession?client_id=witus-inbox";
  const ORIGIN = "https://inbox.witus.online";

  /** Records every effect in call order. */
  function recorder(opts: { localFails?: boolean } = {}) {
    const calls: string[] = [];
    const effects: SignOutEffects = {
      endLocalSession: async () => {
        calls.push("endLocalSession");
        if (opts.localFails) throw new Error("network");
      },
      navigate: (url) => {
        calls.push(`navigate:${url}`);
      },
    };
    return { calls, effects };
  }

  it('"Sign out" ends the local session, then goes to /auth/sign-in, never the IdP', async () => {
    const { calls, effects } = recorder();
    await signOutHere(effects);
    expect(calls).toEqual(["endLocalSession", "navigate:/auth/sign-in"]);
    expect(LOCAL_SIGN_OUT_DESTINATION).toBe("/auth/sign-in");
    expect(calls.join(" ")).not.toContain("endsession");
  });

  it('"Sign out" still navigates locally if ending the session throws', async () => {
    const { calls, effects } = recorder({ localFails: true });
    await signOutHere(effects);
    expect(calls).toEqual(["endLocalSession", "navigate:/auth/sign-in"]);
  });

  it('"Sign out" ignores a configured end-session URL entirely', () => {
    const src = stripComments(read("components/SignOutButton.tsx"));
    const plain = src.slice(
      src.indexOf("export function SignOutButton"),
      src.indexOf("export function SignOutEverywhereButton")
    );
    expect(plain).not.toContain("endSessionUrl");
    expect(plain).not.toContain("signOutEverywhere");
    expect(plain).toContain("signOutHere(browserEffects)");
    expect(plain).toContain("{pending ? SIGNING_OUT_LABEL : SIGN_OUT_LABEL}");
    // The page passes the end-session URL only to the everywhere control.
    const page = stripComments(read("app/inbox/page.tsx"));
    expect(page).toContain("<SignOutButton />");
    expect(page).toContain("<SignOutEverywhereButton endSessionUrl={getWitusEndSessionUrl()} />");
  });

  it("uses the exact accessible names and help text", () => {
    expect(SIGN_OUT_LABEL).toBe("Sign out");
    expect(SIGN_OUT_EVERYWHERE_LABEL).toBe("Sign out of WitUS everywhere");
    expect(SIGN_OUT_EVERYWHERE_HELP).toBe(
      "Also signs you out of WitUS. Other WitUS apps you are signed in to stay signed in until you sign out of them."
    );
    // The old flipping label is gone.
    expect(stripComments(read("components/SignOutButton.tsx"))).not.toContain(
      '"Sign out of WitUS"'
    );
  });

  it("everywhere: destroys the local session BEFORE navigating to the IdP", async () => {
    const { calls, effects } = recorder();
    await signOutEverywhere(END_SESSION, ORIGIN, effects);
    expect(calls).toEqual([
      "endLocalSession",
      `navigate:${END_SESSION}&post_logout_redirect_uri=${encodeURIComponent(`${ORIGIN}/`)}`,
    ]);
  });

  it("everywhere: still hands off to the IdP if ending the local session throws", async () => {
    const { calls, effects } = recorder({ localFails: true });
    await signOutEverywhere(END_SESSION, ORIGIN, effects);
    expect(calls[0]).toBe("endLocalSession");
    expect(calls[1]).toContain("/oauth2/endsession?client_id=");
  });

  it("everywhere: sends client_id and post_logout_redirect_uri with the trailing slash", () => {
    expect(endSessionRedirectUrl(END_SESSION, ORIGIN)).toBe(
      "https://accounts.witus.online/api/idp/oauth2/endsession?client_id=witus-inbox&post_logout_redirect_uri=https%3A%2F%2Finbox.witus.online%2F"
    );
    // The server-resolved URL carries client_id, which better-auth requires
    // without an id_token_hint.
    expect(stripComments(read("lib/env.ts"))).toContain(
      "?client_id=${encodeURIComponent(clientId)}"
    );
  });

  it("everywhere: renders nothing when no end-session URL was resolved", () => {
    const src = stripComments(read("components/SignOutButton.tsx"));
    const everywhere = src.slice(src.indexOf("export function SignOutEverywhereButton"));
    expect(everywhere).toContain("if (!endSessionUrl) return null;");
    // The early return comes before any rendered control.
    expect(everywhere.indexOf("return null")).toBeLessThan(everywhere.indexOf("<Button"));
  });

  it("everywhere: the help text is visible and referenced by aria-describedby", () => {
    const src = stripComments(read("components/SignOutButton.tsx"));
    const everywhere = src.slice(src.indexOf("export function SignOutEverywhereButton"));
    expect(everywhere).toContain("const helpId = useId();");
    expect(everywhere).toContain("aria-describedby={helpId}");
    expect(everywhere).toMatch(/<p id=\{helpId\}[^>]*>\s*\{SIGN_OUT_EVERYWHERE_HELP\}/);
    expect(everywhere).toContain('variant="secondary"');
  });

  it("uses a full navigation, not a router push (the everywhere flow leaves this origin)", () => {
    const src = stripComments(read("components/SignOutButton.tsx"));
    expect(src).not.toContain("useRouter");
    expect(src).not.toContain("router.push");
    expect(src).toContain("window.location.assign(url)");
    expect(src).toContain("signOut({ redirect: false })");
  });
});

describe("the redirect loop guard", () => {
  it("skips the probe once this tab has already tried", () => {
    expect(silentSsoDecision({ endpoint: ENDPOINT, search: "", attempted: true })).toEqual({
      attempt: false,
      skip: "already-attempted",
    });
  });

  it("accepts ?sso=tried as the half that survives a browser with no sessionStorage", () => {
    for (const search of ["?sso=tried", "sso=tried", "?callbackUrl=%2Finbox&sso=tried"]) {
      expect(hasAttemptMarker(search)).toBe(true);
      expect(silentSsoDecision({ endpoint: ENDPOINT, search })).toEqual({
        attempt: false,
        skip: "already-attempted",
      });
    }
    for (const search of ["", null, undefined, "?sso=", "?sso=nope", "?callbackUrl=%2Finbox"]) {
      expect(hasAttemptMarker(search)).toBe(false);
    }
  });

  it("writes the marker BEFORE the redirect, never after the return", () => {
    const src = stripComments(read("components/WitusSsoButton.tsx"));
    const marker = src.indexOf("writeAttempted()");
    const redirect = src.indexOf('signIn("witus"');
    expect(marker).toBeGreaterThan(-1);
    expect(redirect).toBeGreaterThan(-1);
    expect(marker).toBeLessThan(redirect);
    // The key comes from the shared constant, not a re-typed literal.
    expect(src).toContain("SSO_ATTEMPT_STORAGE_KEY");
    expect(SSO_ATTEMPT_STORAGE_KEY).toBe("witus.sso.attempted");
    // sessionStorage throws outright in some privacy modes: both halves wrapped.
    expect(src.match(/try\s*{/g) ?? []).toHaveLength(2);
  });

  it("does not ask on behalf of someone already signed in", () => {
    expect(silentSsoDecision({ endpoint: ENDPOINT, signedIn: true })).toEqual({
      attempt: false,
      skip: "already-signed-in",
    });
  });

  it("attempts on a clean first visit with an endpoint configured", () => {
    expect(silentSsoDecision({ endpoint: ENDPOINT, search: "" })).toEqual({ attempt: true });
  });
});

describe("the probe answer is display copy, and a failure is invisible", () => {
  it("reads a name out of the documented response shape", () => {
    expect(parseSilentSsoIdentity({ signedIn: true, user: { name: "Anthony McDonald" } })).toEqual({
      label: "Anthony McDonald",
    });
  });

  it("renders nothing for every not-signed-in or malformed answer", () => {
    const nothing = [
      { signedIn: false },
      { signedIn: false, user: { name: "stale" } },
      null,
      undefined,
      "",
      "signed in!",
      42,
      {},
      { user: {} },
      { user: { name: "" } },
      { user: { name: "   " } },
      { user: { name: 12345 } },
    ];
    for (const payload of nothing) {
      expect(parseSilentSsoIdentity(payload)).toBeNull();
    }
  });

  it("falls back to email when there is no name", () => {
    expect(parseSilentSsoIdentity({ signedIn: true, user: { email: "a@awews.com" } })).toEqual({
      label: "a@awews.com",
    });
  });

  it("sanitizes: control chars stripped, trimmed, capped at 48 with an ellipsis", () => {
    expect(parseSilentSsoIdentity({ user: { name: "  Bad Name\n  " } })).toEqual({
      label: "BadName",
    });
    const long = "A".repeat(80);
    const label = parseSilentSsoIdentity({ user: { name: long } })?.label ?? "";
    expect(label).toHaveLength(48);
    expect(label.endsWith("…")).toBe(true);
  });

  it("gives the plain label when the probe found nothing", () => {
    expect(continueAsLabel(null)).toBe("Sign in with WitUS");
    expect(continueAsLabel({ label: "Anthony" })).toBe("Continue as Anthony");
  });

  it("swallows every probe failure and never renders an error", () => {
    const src = stripComments(read("components/WitusSsoButton.tsx"));
    expect(src).toContain(".catch(() => {");
    // No error state at all: there is nothing a failed probe could put on screen.
    expect(src).not.toMatch(/setError|role="alert"/);
    // Bounded: an aborted probe is better than a page that waits on the IdP.
    expect(src).toContain("controller.abort()");
    expect(src).toContain("SILENT_SSO_TIMEOUT_MS");
    // The name never leaves the button.
    expect(src).not.toMatch(/identity\.label\s*[,)]/);
  });
});

describe('the admin-gated opt-out: this app never says "Continue as <name>"', () => {
  // BAM, 2026-09-01: "dont show them the 'continue as Jane'". WitUS Inbox admits
  // only ADMIN_EMAIL, and it cannot know who the browser is until the OIDC flow has
  // already run — so the only honest implementation is to not ask at all. These pin
  // BOTH halves: the app is opted out, and the mechanism still works for the apps
  // that keep it.

  it("skips the probe outright when the app opts out, however well configured it is", () => {
    for (const search of ["", "?sso=tried"]) {
      for (const signedIn of [false, true]) {
        expect(
          silentSsoDecision({
            endpoint: ENDPOINT,
            search,
            signedIn,
            showContinueAs: false,
          }),
        ).toEqual({ attempt: false, skip: "continue-as-disabled" });
      }
    }
  });

  it("still probes for an app that has not opted out (the shared path is intact)", () => {
    expect(
      silentSsoDecision({ endpoint: ENDPOINT, search: "", showContinueAs: true }),
    ).toEqual({ attempt: true });
    // Omitting the flag keeps today's behaviour for every other ecosystem app.
    expect(silentSsoDecision({ endpoint: ENDPOINT, search: "" })).toEqual({
      attempt: true,
    });
  });

  it("has this app opted out, and says why in the source", () => {
    const env = read("lib/env.ts");
    expect(stripComments(env)).toMatch(
      /export const WITUS_SHOW_CONTINUE_AS = false/,
    );
    // The comment is load-bearing: without it a later session "restores" the
    // personalized label as a missing feature.
    expect(env).toMatch(/admin-gated|ADMIN-GATED/i);
    expect(env).toMatch(/opt-out, not a deletion|OPT-OUT, NOT A DELETION/i);
  });

  it("wires the opt-out through the page to the button", () => {
    const page = stripComments(read("app/auth/sign-in/page.tsx"));
    expect(page).toContain("showContinueAs={WITUS_SHOW_CONTINUE_AS}");
    const button = stripComments(read("components/WitusSsoButton.tsx"));
    // The flag reaches the decision helper, which is what actually stops the fetch.
    expect(button).toMatch(/silentSsoDecision\(\{[\s\S]*?showContinueAs,[\s\S]*?\}\)/);
  });

  it("keeps the probe implementation and its label helper in place, not deleted", () => {
    // The mechanism is shared with the open apps. An opt-out that deletes the code
    // is not an opt-out.
    expect(continueAsLabel({ label: "Jane" })).toBe("Continue as Jane");
    expect(parseSilentSsoIdentity({ user: { name: "Jane" } })).toEqual({
      label: "Jane",
    });
    expect(stripComments(read("components/WitusSsoButton.tsx"))).toContain(
      "fetch(endpoint",
    );
  });
});
