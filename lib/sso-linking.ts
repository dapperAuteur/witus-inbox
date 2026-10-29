// lib/sso-linking.ts
// Account linking policy for "Sign in with WitUS".
//
// THE BUG THIS FIXES (2026-10-29). The owner's account was created by the email
// (magic-link) provider. The first time they used "Sign in with WitUS", NextAuth v4
// found no `account` row for provider `witus`, looked the user up by email, found the
// email-created user, and threw AccountNotLinkedError, because an OAuth provider only
// links to an existing same-email user when it sets `allowDangerousEmailAccountLinking`
// (node_modules/next-auth/core/lib/callback-handler.js, the `account.type === "oauth"`
// branch). The callback route turns that into `?error=OAuthAccountNotLinked`, which
// lib/auth-error.ts renders as "That account is not linked."
//
// THE FIX, AND WHY IT IS SAFE HERE.
//   1. `allowDangerousEmailAccountLinking: true` on the `witus` provider ONLY (the
//      email provider is not an OAuth provider; no other OAuth provider exists here).
//      NextAuth's docs: automatic linking "is not secure between arbitrary providers",
//      and it is reasonable "if you trust that the provider involved has securely
//      verified the email address associated with the account" (NextAuth.js, n.d.,
//      https://next-auth.js.org/configuration/providers/oauth, read 2026-10-29).
//   2. The IdP is ours: accounts.witus.online runs better-auth's oidcProvider plugin,
//      which puts `email_verified: user.emailVerified` in the ID token for the `email`
//      scope (gemini/witus node_modules/better-auth/dist/plugins/oidc-provider/index.mjs),
//      and its magic-link sign-in sets `emailVerified: true` only after the link is
//      clicked. better-auth's own linking rule is the same shape: link automatically
//      "if the provider confirms the user's email as verified" (Better Auth, n.d.,
//      https://www.better-auth.com/docs/concepts/users-accounts, read 2026-10-29).
//   3. NextAuth's flag does not look at `email_verified` at all, so this module adds
//      that half: the signIn callback (which runs BEFORE the linking step in
//      next-auth/core/routes/callback.js) refuses a WitUS sign-in whose ID token does
//      not assert `email_verified === true`. An unverified WitUS address therefore
//      never reaches the linking code, and never passes the admin gate either.
//
// Pure (no env, no next/*, no server-only) so lib/sso-linking.test.ts can pin it.

/** The NextAuth provider id for "Sign in with WitUS" (lib/auth.ts). */
export const WITUS_PROVIDER_ID = "witus";

/**
 * The `?error=` code the sign-in page shows when the IdP did not assert a verified
 * email. Not a NextAuth code; lib/auth-error.ts maps it to a notice.
 */
export const WITUS_EMAIL_UNVERIFIED_ERROR = "WitusEmailUnverified";

/** Where the signIn callback sends an unverified WitUS sign-in. */
export const WITUS_EMAIL_UNVERIFIED_REDIRECT = `/auth/sign-in?error=${WITUS_EMAIL_UNVERIFIED_ERROR}`;

/**
 * Only on the WitUS provider. Kept here, beside the policy that makes it safe, so a
 * test can assert the two travel together.
 */
export const WITUS_ALLOW_EMAIL_ACCOUNT_LINKING = true;

/**
 * True only when the IdP asserted a verified email: the boolean `true`. better-auth
 * emits a boolean. A string "true", a missing claim, or any other value is treated as
 * unverified, because the cost of a false "yes" is an account takeover and the cost
 * of a false "no" is using the email form.
 */
export function isEmailVerifiedClaim(profile: unknown): boolean {
  if (!profile || typeof profile !== "object") return false;
  return (profile as { email_verified?: unknown }).email_verified === true;
}

/**
 * Lowercase and trim the IdP's email so it matches the row the email provider wrote
 * (NextAuth's EmailProvider lowercases identifiers), and so the adapter's exact-match
 * getUserByEmail finds the existing user instead of trying to create a duplicate.
 */
export function normalizeEmail(email: string | null | undefined): string | null {
  if (typeof email !== "string") return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed === "" ? null : trimmed;
}

/**
 * The provider-specific half of the signIn callback.
 *
 * Returns `true` when the sign-in may continue to the admin gate, or a redirect
 * path when it must stop. Providers other than WitUS pass through untouched.
 */
export function witusSignInCheck(
  providerId: string | null | undefined,
  oauthProfile: unknown,
): true | string {
  if (providerId !== WITUS_PROVIDER_ID) return true;
  return isEmailVerifiedClaim(oauthProfile) ? true : WITUS_EMAIL_UNVERIFIED_REDIRECT;
}
