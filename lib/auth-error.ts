// lib/auth-error.ts
// What /auth/sign-in does with an `?error=<code>` that NextAuth put on the URL.
//
// WHY THIS FILE EXISTS. lib/auth.ts now sets `pages.error = "/auth/sign-in"`, so
// this app owns the failure surface instead of dumping people on NextAuth's raw
// /api/auth/error page (no message, no link back, no route to anything — a wall).
//
// THE COUPLING THIS MODULE UNTANGLES. `pages.error` is ONE url for EVERY failure
// that reaches it. Verified against the installed next-auth v4
// (node_modules/next-auth/core/index.js, the `case "error"` branch): a fixed list
// of sign-in-ish codes — Signin, OAuthSignin, OAuthCallback, OAuthCreateAccount,
// EmailCreateAccount, Callback, OAuthAccountNotLinked, EmailSignin,
// CredentialsSignin, SessionRequired — is bounced to the SIGN-IN page instead,
// while everything else (AccessDenied, Verification, Configuration, Default) goes
// to `pages.error`. Both of those pages are /auth/sign-in here, so this module sees
// the whole set — including Verification, an expired or already-used magic link.
// Routing every code to the waitlist would tell someone whose link merely expired
// that they have no access, so the code is read and branched on. That is this
// module's whole job.
//
// It is pure (no env, no next/*, no window) so lib/auth-error.test.ts can pin the
// mapping without a browser or a server.

/** What the sign-in page should do about the error code on its URL. */
export type AuthErrorAction =
  | { kind: "redirect"; to: string }
  | { kind: "notice"; title: string; body: string };

/**
 * Where a refused non-admin goes.
 *
 * `?from=sso` is display context only — the waitlist page uses it to say "that
 * WitUS account doesn't have access here" rather than the generic invitation. It
 * is a query param a stranger can type, so it may never gate anything.
 */
export const WAITLIST_PATH = "/auth/waitlist?from=sso";

/**
 * Map a NextAuth `?error=` code to what the sign-in page should do.
 *
 * Returns `null` for "no error on this URL" — the ordinary sign-in page.
 *
 * An unknown code gets the generic notice rather than being ignored: a sign-in
 * page that looks untouched after a failed sign-in is the wall we are removing.
 */
export function authErrorAction(
  code: string | null | undefined,
): AuthErrorAction | null {
  if (typeof code !== "string" || code.trim() === "") return null;

  switch (code) {
    // The admin gate in lib/auth.ts refused this account. This is the case BAM
    // asked for (2026-09-01): route them to the waitlist and ask.
    case "AccessDenied":
      return { kind: "redirect", to: WAITLIST_PATH };

    // MAGIC LINK, NOT ACCESS. The email flow must not regress into a waitlist
    // pitch: this person may well be the admin, holding a link that expired or was
    // already used (each link is single-use).
    case "Verification":
      return {
        kind: "notice",
        title: "That sign-in link has expired",
        body: "Sign-in links can only be used once, and they expire quickly. Enter your email below and we'll send a fresh one.",
      };

    // The app is misconfigured (missing secret, bad provider). Nothing the visitor
    // can do; say so plainly instead of blaming them.
    case "Configuration":
      return {
        kind: "notice",
        title: "Sign-in is misconfigured",
        body: "Something on our side is set up wrong, so sign-in cannot complete. This is not something you can fix — please try again later.",
      };

    // The magic-link email could not be sent.
    case "EmailSignin":
    case "EmailCreateAccount":
      return {
        kind: "notice",
        title: "We could not send that email",
        body: "The sign-in link failed to send. Check the address and try again.",
      };

    // The WitUS round trip started but did not finish. Usually transient.
    case "OAuthSignin":
    case "OAuthCallback":
    case "OAuthCreateAccount":
    case "Callback":
      return {
        kind: "notice",
        title: "Sign-in with WitUS did not complete",
        body: "The round trip to WitUS was interrupted. Try again, or use the email form above.",
      };

    // Same address, two providers, and the WitUS account was never linked to it.
    case "OAuthAccountNotLinked":
      return {
        kind: "notice",
        title: "That account is not linked",
        body: "This email already signed in here a different way. Use the email form above instead.",
      };

    // The visitor asked for a page that needs a session and had none. Not a
    // failure — just say what to do.
    case "SessionRequired":
      return {
        kind: "notice",
        title: "Sign in to continue",
        body: "That page needs a signed-in session. Sign in below and you'll be sent back to it.",
      };

    default:
      return {
        kind: "notice",
        title: "Sign-in did not complete",
        body: "Something went wrong on the way back. Try again, or use the email form above.",
      };
  }
}

/**
 * Read the `error` value out of a Next.js `searchParams` object.
 *
 * Next hands repeated params through as an array; take the first, ignore the rest.
 * Anything that is not a non-empty string is "no error".
 */
export function errorCodeFromSearchParams(
  params: Record<string, string | string[] | undefined> | undefined,
): string | null {
  const raw = params?.error;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.trim() !== "" ? value : null;
}
