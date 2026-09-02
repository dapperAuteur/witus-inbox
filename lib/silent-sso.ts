/**
 * Ecosystem SSO helpers: the silent "Continue as <name>" check on the sign-in
 * page, and the shared-session sign-out URL that pairs with it.
 *
 * NO `import "server-only"` here, unlike the rest of lib/. These are pure
 * functions with no window/process access at module scope, and the sign-in
 * button imports them into the browser bundle. The values they need from the
 * environment are resolved on the server (lib/env.ts) and passed down as props.
 *
 * ── Feature 1: "Continue as <name>" ──────────────────────────────────────────
 * Signing in here sends you to accounts.witus.online even when another tab
 * already has you signed in to a WitUS app. BAM chose the non-automatic design
 * on 2026-08-30: render the sign-in form immediately, ask the IdP who this
 * browser is IN PARALLEL, and relabel the existing "Sign in with WitUS" button
 * to "Continue as <name>" if an answer arrives. Nothing waits on the probe.
 *
 * A hidden-iframe `prompt=none` check would be the OIDC-native way to ask, but
 * it is a navigation (or an iframe Safari's ITP already blocks), so we ask a
 * purpose-built CORS endpoint on the IdP instead.
 *
 * THE PROBE CARRIES THE IdP's COOKIE AS A THIRD-PARTY COOKIE. It answers on
 * Chrome/Edge and answers nothing under Safari ITP or Firefox Total Cookie
 * Protection. That is the design, not a bug: a probe that answers nothing
 * renders nothing and the visitor keeps the exact page they already had.
 *
 * THE NAME IT RETURNS IS DISPLAY COPY, NEVER A CREDENTIAL. It crosses an origin
 * boundary, so it is client-supplied by definition. It must never gate access,
 * populate a session, or be sent anywhere. Clicking the button runs the real
 * OIDC code flow (NextAuth's `witus` provider, lib/auth.ts), which is the only
 * thing that establishes identity — and the `signIn` callback there still
 * requires ADMIN_EMAIL regardless of what any label said.
 *
 * ── Feature 2: global sign-out ───────────────────────────────────────────────
 * BAM's decision, 2026-08-30: "signout signs out of every app". Ending only the
 * local NextAuth session leaves the IdP session alive, which — now that
 * "Continue as ..." exists — means signing out and coming back offers to sign
 * you straight back in. That reads as a broken logout.
 *
 * ── This app is single-host and admin-only ───────────────────────────────────
 * witus-learn's version of this file carries a per-tenant `enabled` gate because
 * it is multi-tenant white-label: a school's own domain must never touch
 * accounts.witus.online. WitUS Inbox has one host (inbox.witus.online) and one
 * permitted user (ADMIN_EMAIL, enforced in lib/auth.ts and proxy.ts), so there
 * is no white-label surface to leak to and no host gate here. The only gate is
 * WITUS_OIDC_CLIENT_ID: with no OIDC client there is nothing to continue as and
 * no shared session to end, and an affordance the visitor cannot complete is
 * worse than no affordance.
 */

/**
 * Fallback discovery URL, shared with lib/auth.ts so the IdP host is asserted in
 * exactly one place (authoritative-values rule). WITUS_OIDC_DISCOVERY_URL wins;
 * this is a labeled fallback, not a value we claim to have verified per-deploy.
 */
export const WITUS_OIDC_DISCOVERY_FALLBACK =
  "https://accounts.witus.online/api/idp/.well-known/openid-configuration";

/** Query param marking "this browser already tried the ecosystem flow here". */
export const SSO_ATTEMPT_PARAM = "sso";
export const SSO_ATTEMPT_VALUE = "tried";

/**
 * sessionStorage key for the same marker. Written IMMEDIATELY BEFORE we send the
 * browser to the IdP, never after it comes back: a marker written on return is a
 * marker that does not exist when the return is the thing that failed.
 */
export const SSO_ATTEMPT_STORAGE_KEY = "witus.sso.attempted";

/** How long to wait for the probe. A silent check that hangs is a broken page. */
export const SILENT_SSO_TIMEOUT_MS = 4000;

/** Longest display name we render. Caps an absurd or hostile value. */
const MAX_LABEL_LENGTH = 48;

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

/** Identity shown on the button. Display only, never a credential. */
export interface SsoIdentity {
  /** What "Continue as ___" says. Already de-controlled, trimmed, length-capped. */
  label: string;
}

export type SilentSsoSkip =
  | "continue-as-disabled"
  | "not-configured"
  | "already-attempted"
  | "already-signed-in";

export type SilentSsoDecision = { attempt: true } | { attempt: false; skip: SilentSsoSkip };

/**
 * Should this browser ask the IdP who it is?
 *
 * `endpoint` is the SERVER-RESOLVED probe URL (null when WITUS_OIDC_CLIENT_ID is
 * unset). It is a hard gate: no configured OIDC client means no request to
 * accounts.witus.online at all.
 *
 * WHY AN APP WOULD PASS `showContinueAs: false`. On an ADMIN-GATED app the
 * personalized label is a promise the app cannot keep. This module CANNOT and MUST
 * NOT tell an admin from a non-admin before the flow runs: the probe answer crosses
 * an origin boundary, so it is client-supplied display copy, and gating access on
 * it would be a security bug. The honest alternative is therefore not "probe and
 * filter" — it is "do not probe". Someone offered "Continue as Jane", who clicks,
 * spends a full OIDC round trip and is then refused, has been invited to a door
 * that gets slammed; the plain "Sign in with WitUS" button makes the same refusal
 * without the personal invitation. WitUS Inbox and Centenarian Coach both pass
 * `false` (BAM, 2026-09-01). DO NOT "restore" the label on either as a missing
 * feature — the mechanism below stays intact and shared for the open apps.
 *
 * The flag is checked FIRST: an opted-out app makes no request whatever else holds.
 */
export function silentSsoDecision(input: {
  endpoint: string | null | undefined;
  search?: string | null;
  attempted?: boolean;
  signedIn?: boolean;
  /** May this app offer "Continue as <name>"? Default true; admin-gated apps pass false. */
  showContinueAs?: boolean;
}): SilentSsoDecision {
  if (input.showContinueAs === false) {
    return { attempt: false, skip: "continue-as-disabled" };
  }
  if (!input.endpoint) return { attempt: false, skip: "not-configured" };
  if (input.signedIn) return { attempt: false, skip: "already-signed-in" };
  if (input.attempted || hasAttemptMarker(input.search)) {
    return { attempt: false, skip: "already-attempted" };
  }
  return { attempt: true };
}

/** Does this query string carry the one-shot marker? Accepts "?a=b" or "a=b". */
export function hasAttemptMarker(search: string | null | undefined): boolean {
  if (typeof search !== "string" || search === "") return false;
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return params.get(SSO_ATTEMPT_PARAM) === SSO_ATTEMPT_VALUE;
}

/**
 * Split a discovery URL into the IdP's origin and its better-auth basePath.
 *
 *   https://accounts.witus.online/api/idp/.well-known/openid-configuration
 *     -> { origin: "https://accounts.witus.online", basePath: "/api/idp" }
 *
 * Everything below derives from this instead of naming the IdP host a second
 * time, so the one external value this app asserts stays the discovery URL it is
 * already configured with.
 */
function splitDiscoveryUrl(
  discoveryUrl: string | null | undefined
): { origin: string; basePath: string } | null {
  if (!discoveryUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(discoveryUrl);
  } catch {
    return null;
  }
  const cut = parsed.pathname.indexOf("/.well-known/");
  if (cut < 0) return null;
  return { origin: parsed.origin, basePath: parsed.pathname.slice(0, cut) };
}

/**
 * The ecosystem session probe: `<idp-origin>/api/ecosystem/session`.
 *
 * Deliberately NOT the IdP's better-auth `/get-session`. That endpoint returns
 * the full `{ session, user }` including the session token, so a credentialed
 * allow-origin on it would let any ecosystem origin — or an XSS on any one of
 * them — lift a live IdP session. `/api/ecosystem/session` (gemini/witus,
 * app/api/ecosystem/session/route.ts) answers with a display label and nothing
 * else, over an allow-origin list derived from the IdP's own client registry.
 *
 * Response shape: `{ signedIn: true, user: { name } }` or `{ signedIn: false }`.
 */
export function silentSsoEndpointFromDiscovery(
  discoveryUrl: string | null | undefined
): string | null {
  const parts = splitDiscoveryUrl(discoveryUrl);
  if (!parts) return null;
  return `${parts.origin}/api/ecosystem/session`;
}

/**
 * The IdP's RP-initiated logout endpoint: `<basePath>/oauth2/endsession`, which
 * is the `end_session_endpoint` its discovery document advertises.
 */
export function endSessionEndpointFromDiscovery(
  discoveryUrl: string | null | undefined
): string | null {
  const parts = splitDiscoveryUrl(discoveryUrl);
  if (!parts) return null;
  return `${parts.origin}${parts.basePath}/oauth2/endsession`;
}

/**
 * Read a display name out of the probe response.
 *
 * Handles `{ signedIn, user: { name } }`, a bare user object, and the signed-out
 * answer (a 200 whose body says `signedIn: false` or is null). Anything else
 * yields null, which renders the ordinary button.
 */
export function parseSilentSsoIdentity(payload: unknown): SsoIdentity | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  if (root.signedIn === false) return null;
  const candidate =
    root.user && typeof root.user === "object" ? (root.user as Record<string, unknown>) : root;
  const label = cleanLabel(candidate.name) ?? cleanLabel(candidate.email);
  return label ? { label } : null;
}

function cleanLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(CONTROL_CHARS, "").trim();
  if (!cleaned) return null;
  return cleaned.length > MAX_LABEL_LENGTH
    ? `${cleaned.slice(0, MAX_LABEL_LENGTH - 1).trimEnd()}…`
    : cleaned;
}

/** Button copy. Kept here so the test pins the exact string the visitor reads. */
export function continueAsLabel(identity: SsoIdentity | null): string {
  return identity ? `Continue as ${identity.label}` : "Sign in with WitUS";
}
