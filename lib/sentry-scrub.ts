import type { ErrorEvent } from "@sentry/nextjs";

/**
 * Sentry `beforeSend` scrubber for WitUS Inbox.
 *
 * Why this file is stricter than the sibling apps' version
 * -------------------------------------------------------
 * This app is the ecosystem's triage inbox. Every request it handles is, in effect, made of
 * credentials and other people's data:
 *   - `/api/ingest` reads an HMAC signature (`x-witus-signature`) over a raw body that was signed
 *     with a shared per-source secret from `INGEST_SOURCES`;
 *   - `/api/inbound-email` reads Mailgun's `signature` / `token` webhook fields;
 *   - the bodies themselves are OTHER APPS' user submissions (names, emails, free text).
 * A crash report is sent to a third party, so none of that may ride along. The bias is
 * REDACT WHEN UNSURE: an over-scrubbed event costs a click to go read the real logs; an
 * under-scrubbed one hands a stranger a working ingest secret.
 *
 * Rules enforced here:
 *   1. `request.data` (the body) is DELETED outright. There is no version of an ingest body that is
 *      safe to forward, and no triage value in it that the form_type tag does not already give.
 *   2. Any header whose NAME matches signature / hmac / secret / token / key / auth / cookie is
 *      dropped. Deny-by-name, not by value, so a new signed header is covered the day it is added.
 *   3. User identity (email, IP, username) is deleted.
 *   4. Remaining free text (message, exception values, URL, query string, breadcrumbs) runs through
 *      `redactSecrets`: token-bearing URLs, bare email addresses, JWTs, long hex digests (an HMAC
 *      signature or an `openssl rand -hex 32` secret) and labelled secrets are replaced.
 *
 * Pure and dependency-free (no `server-only`) so the same scrub runs on the client config and is
 * directly unit-testable. See `lib/sentry-scrub.test.ts`. It never returns null: we still want the
 * crash signal, just with the credentials taken out.
 */

export const REDACTED = "[redacted]";
export const REDACTED_LINK = "[redacted link]";
export const REDACTED_EMAIL = "[redacted email]";

/** Query-param names that carry (or plausibly carry) a bearer secret. Substring, case-insensitive. */
const SECRET_PARAM_RE =
  /(token|secret|code|otp|passcode|password|pwd|pin|key|jwt|sig|signature|hmac|hash|auth|credential|session|magic|invite|nonce)/i;

/** Path prefixes that are credential-carrying by construction in this app and its siblings. */
const SECRET_PATH_RE =
  /^\/(api\/auth|api\/ingest|api\/inbound-email|auth|join|invite|accept|reset|reset-password|set-password|magic-link|confirm|activate|unsubscribe)(\/|$)/i;

/** A path segment that looks like a generated token: long and from a token generator's alphabet. */
const TOKENISH_SEGMENT_RE = /^[A-Za-z0-9_-]{16,}$/;

/** Absolute http(s) URLs. Trailing punctuation is excluded so prose survives. */
const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

/** Bare email address anywhere in free text (submitter emails arrive in ingest payloads). */
const EMAIL_RE = /\b[^\s<>@,;]+@[^\s<>@,;]+\.[A-Za-z]{2,}\b/g;

/** JSON Web Token (NextAuth session tokens are JWTs). */
const JWT_RE = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;

/**
 * A long hex run: an HMAC-SHA256 digest is 64 hex chars and `openssl rand -hex 32` is too, which
 * is exactly what `x-witus-signature` and every `INGEST_SOURCES` secret look like. 32 is the floor
 * so a UUID (whose longest unbroken hex run is 12) is never mistaken for one.
 */
const LONG_HEX_RE = /\b[A-Fa-f0-9]{32,}\b/g;

/** Long base64url run: a Mailgun webhook `token`, a nanoid, a raw session cookie value. */
const LONG_TOKEN_RE = /\b(?=[A-Za-z0-9_-]*[0-9])(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{40,}\b/g;

/**
 * A labelled raw secret that is not a URL: `signature: abc`, `hmac_secret = ...`,
 * `token is ...`. The separator is REQUIRED so ordinary prose ("the signature check failed") is
 * left alone.
 */
const SECRET_LABEL_RE =
  /\b(hmac[_-]?secret|ingest[_-]?secret|signing[_-]?key|api[_-]?key|secret|signature|hmac|token|bearer|password|passcode|pin|authorization)\b\s*(?:is|:|=)\s*(["']?)([^\s"',;]{3,})\2/gi;

/** Header names we refuse to forward, matched case-insensitively as a substring of the name. */
const SECRET_HEADER_RE =
  /(signature|hmac|secret|token|api[-_]?key|^key$|[-_]key$|auth|cookie|credential|password|session)/i;

/** True when a URL carries a secret and must not be forwarded. Unparseable counts as sensitive. */
export function isSensitiveUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return true; // cannot reason about it, so do not send it
  }
  for (const key of url.searchParams.keys()) {
    if (SECRET_PARAM_RE.test(key)) return true;
  }
  if (SECRET_PATH_RE.test(url.pathname)) return true;
  for (const segment of url.pathname.split("/")) {
    if (TOKENISH_SEGMENT_RE.test(segment)) return true;
  }
  return false;
}

/** Replace every credential-shaped substring in free text. Safe to run repeatedly. */
export function redactSecrets(text: string): string {
  let out = text.replace(URL_RE, (match) => (isSensitiveUrl(match) ? REDACTED_LINK : match));
  out = out.replace(JWT_RE, REDACTED);
  out = out.replace(SECRET_LABEL_RE, (_match, label: string) => `${label}: ${REDACTED}`);
  out = out.replace(EMAIL_RE, REDACTED_EMAIL);
  out = out.replace(LONG_HEX_RE, REDACTED);
  out = out.replace(LONG_TOKEN_RE, REDACTED);
  return out;
}

function scrub(value: string | undefined): string | undefined {
  return value ? redactSecrets(value) : value;
}

/** Recursively redact string leaves of an arbitrary attached object (breadcrumb data, extras). */
function scrubDeep(value: unknown, depth = 0): unknown {
  if (depth > 4) return REDACTED;
  if (typeof value === "string") return redactSecrets(value);
  if (Array.isArray(value)) return value.map((item) => scrubDeep(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_HEADER_RE.test(key) ? REDACTED : scrubDeep(inner, depth + 1);
    }
    return out;
  }
  return value;
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.message) event.message = scrub(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrub(ex.value);
  }

  // Never ship the account identity or network origin.
  if (event.user) {
    delete event.user.email;
    delete event.user.ip_address;
    delete event.user.username;
  }

  if (event.request) {
    if (typeof event.request.url === "string") event.request.url = scrub(event.request.url);
    if (typeof event.request.query_string === "string") {
      event.request.query_string = scrub(event.request.query_string);
    }

    // The body is a signed cross-app payload full of other people's submissions. Never forward it.
    delete event.request.data;
    delete event.request.cookies;

    const headers = event.request.headers as Record<string, string> | undefined;
    if (headers) {
      for (const name of Object.keys(headers)) {
        if (SECRET_HEADER_RE.test(name)) delete headers[name];
        else headers[name] = redactSecrets(headers[name]);
      }
    }
  }

  for (const crumb of event.breadcrumbs ?? []) {
    if (crumb.message) crumb.message = scrub(crumb.message);
    if (crumb.data) crumb.data = scrubDeep(crumb.data) as Record<string, unknown>;
  }

  if (event.extra) event.extra = scrubDeep(event.extra) as Record<string, unknown>;

  return event;
}
