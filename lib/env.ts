import "server-only";
import { z } from "zod";
import {
  WITUS_OIDC_DISCOVERY_FALLBACK,
  endSessionEndpointFromDiscovery,
  silentSsoEndpointFromDiscovery,
} from "@/lib/silent-sso";

const EnvSchema = z.object({
  STORAGE_DATABASE_URL: z.string().url(),
  // Optional: NextAuth v4 falls back to `VERCEL_URL` on Vercel preview/prod
  // when this is unset, and to the request origin in local dev. Set
  // explicitly in Production to your canonical URL (e.g. https://inbox.example.com).
  NEXTAUTH_URL: z.string().url().optional(),
  NEXTAUTH_SECRET: z.string().min(16),
  EMAIL_SERVER: z.string().min(1),
  EMAIL_FROM: z
    .string()
    .min(3)
    .refine(
      (v) =>
        /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(v) ||
        /<[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>\s*$/.test(v),
      'Must be "addr@host" or "Name <addr@host>"'
    ),
  ADMIN_EMAIL: z.string().email(),
  MAILGUN_API_KEY: z.string().optional(),
  MAILGUN_DOMAIN: z.string().optional(),
  // Mailgun's HTTP webhook signing key (separate from MAILGUN_API_KEY).
  // Required if /api/inbound-email is exposed; without it, the inbound
  // route refuses every incoming request.
  MAILGUN_WEBHOOK_SIGNING_KEY: z.string().optional(),
  BVC_SUBMISSIONS_EMAIL: z
    .string()
    .email()
    .default("bvc.witus.submissions@witus.online"),
  INGEST_SOURCES: z.string().optional(),
  MOBILE_TEXT_ALERTS_API_KEY: z.string().optional(),
  MOBILE_TEXT_ALERTS_RECIPIENTS: z.string().optional(),
  // WitUS Triage Agent auto-trigger. Both optional: when either is unset the
  // ingest route skips the triage webhook silently (e.g. local dev).
  // TRIAGE_START_URL must be the agent's full /api/triage/start endpoint URL.
  // Kept as a plain string (not .url()) so a malformed value can't throw here
  // and break every route — the ingest route guards it at fetch time.
  TRIAGE_START_URL: z.string().optional(),
  TRIAGE_INGEST_SECRET: z.string().optional(),
});

type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/**
 * Lazy env getter. Validates on first call so Next build-time analysis does
 * not trip on missing values. Every consumer should call `getEnv()` inside
 * a request handler or server function, never at module top-level.
 */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/**
 * The WITUS_OIDC_* trio is deliberately OUTSIDE the zod schema above (see
 * lib/auth.ts): a missing value must never throw and take every route down with
 * it, it just leaves ecosystem SSO dark. The three getters below are the only
 * readers besides the provider definition, and they are functions rather than
 * module-level consts so the value is read per request, matching getEnv()'s
 * lazy contract instead of freezing whatever the build environment had.
 */

/** Is "Sign in with WitUS" actually wired up? Same gate lib/auth.ts uses to register the provider. */
export function isWitusOidcConfigured(): boolean {
  return Boolean(process.env.WITUS_OIDC_CLIENT_ID);
}

function witusDiscoveryUrl(): string {
  return process.env.WITUS_OIDC_DISCOVERY_URL ?? WITUS_OIDC_DISCOVERY_FALLBACK;
}

/**
 * Where the sign-in page's silent "Continue as ..." check asks the IdP who this
 * browser is, or `null` when ecosystem SSO is not configured — in which case the
 * sign-in page makes no cross-origin request at all.
 *
 * Derived from the discovery URL this app already points at, so nothing new
 * about accounts.witus.online is asserted here. The IdP must also allow this
 * origin with credentials, or the probe simply answers nothing (which renders
 * nothing — see lib/silent-sso.ts).
 */
export function getWitusSilentSsoEndpoint(): string | null {
  if (!isWitusOidcConfigured()) return null;
  return silentSsoEndpointFromDiscovery(witusDiscoveryUrl());
}

/**
 * Where sign-out ends the SHARED WitUS session (BAM, 2026-08-30: signing out of
 * one WitUS app signs you out of all of them). `null` when this app is not a
 * configured OIDC client — there is then no shared session to end and sign-out
 * stays purely local.
 *
 * `client_id` IS REQUIRED, not optional: better-auth's endsession endpoint
 * rejects a `post_logout_redirect_uri` with `invalid_request` unless the request
 * carries either a verifiable `id_token_hint` or an explicit `client_id`, and we
 * have no id_token client-side. It is baked in HERE, on the server, because the
 * sign-out button is a client component and must not be handed the raw env.
 * Callers append `&post_logout_redirect_uri=...` (see components/SignOutButton).
 */
export function getWitusEndSessionUrl(): string | null {
  const clientId = process.env.WITUS_OIDC_CLIENT_ID;
  if (!clientId) return null;
  const base = endSessionEndpointFromDiscovery(witusDiscoveryUrl());
  if (!base) return null;
  return `${base}?client_id=${encodeURIComponent(clientId)}`;
}

/**
 * SHOULD THE SIGN-IN PAGE OFFER "Continue as <name>"? NO, ON THIS APP.
 *
 * BAM, 2026-09-01: "if non-admin attempts to login, route them to waitlist and ask
 * them if they want to join waitlist, dont show them the 'continue as Jane'".
 *
 * WitUS Inbox is ADMIN-GATED: lib/auth.ts's `signIn` callback completes a sign-in
 * only for ADMIN_EMAIL. /auth/sign-in, however, is publicly reachable (proxy.ts
 * matches only /inbox and the two API prefixes), and this app cannot know who the
 * browser is until the OIDC flow has already run. The silent probe answers "there
 * is a WitUS session, and it belongs to Jane" — it CANNOT answer "Jane may sign in
 * here", and must never be asked to: the answer arrives across an origin boundary,
 * so it is display copy, and gating access on it would be a security bug (see
 * lib/silent-sso.ts).
 *
 * That leaves one honest option: don't ask. A personalized invitation to a door
 * that will be slammed is worse than a plain door. Everyone still sees the ordinary
 * "Sign in with WitUS" button; a non-admin who clicks it is now routed to
 * /auth/waitlist instead of a raw NextAuth error page (lib/auth-error.ts).
 *
 * THIS IS AN OPT-OUT, NOT A DELETION. The probe, its helpers, and lib/silent-sso.test.ts
 * stay intact — they are the shared ecosystem implementation and the open apps
 * should keep using them. It is a plain constant rather than an env var on purpose:
 * this is a property of what this app IS (single-admin), not of how a deployment is
 * configured, and a deploy must not be able to switch it back on by accident.
 */
export const WITUS_SHOW_CONTINUE_AS = false;
