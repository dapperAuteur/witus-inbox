import "server-only";
import type { NextAuthOptions } from "next-auth";
import EmailProvider from "next-auth/providers/email";
import type { OAuthConfig } from "next-auth/providers/oauth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { getDb } from "@/db";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";
import { getEnv, isWitusOidcConfigured } from "@/lib/env";
import { WITUS_OIDC_DISCOVERY_FALLBACK } from "@/lib/silent-sso";

const env = getEnv();
const adminEmail = env.ADMIN_EMAIL.toLowerCase();

interface WitusProfile {
  sub: string;
  email?: string;
  name?: string;
}

/**
 * "Sign in with WitUS" — the ecosystem IdP (accounts.witus.online) as a NextAuth
 * OIDC provider. Added only when WITUS_OIDC_CLIENT_ID is set, so a missing env
 * never breaks the build. Discovery URL is env-overridable
 * (WITUS_OIDC_DISCOVERY_URL); the fallback literal lives in lib/silent-sso.ts so
 * the IdP host is named in exactly one place, and it is a labeled fallback, not
 * an asserted value (per the authoritative-values rule). Inbox stays admin-only
 * — the signIn callback below still requires ADMIN_EMAIL regardless of provider.
 */
function witusProvider(): OAuthConfig<WitusProfile> {
  return {
    id: "witus",
    name: "WitUS",
    type: "oauth",
    wellKnown: process.env.WITUS_OIDC_DISCOVERY_URL ?? WITUS_OIDC_DISCOVERY_FALLBACK,
    clientId: process.env.WITUS_OIDC_CLIENT_ID,
    clientSecret: process.env.WITUS_OIDC_CLIENT_SECRET,
    authorization: { params: { scope: "openid email profile" } },
    idToken: true,
    checks: ["pkce", "state"],
    profile(profile) {
      return {
        id: profile.sub,
        email: profile.email ?? null,
        name: profile.name ?? null,
        image: null,
      };
    },
  };
}

export const authOptions: NextAuthOptions = {
  adapter: DrizzleAdapter(getDb(), {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [
    EmailProvider({
      server: env.EMAIL_SERVER,
      from: env.EMAIL_FROM,
    }),
    ...(isWitusOidcConfigured() ? [witusProvider()] : []),
  ],
  session: { strategy: "jwt" },
  secret: env.NEXTAUTH_SECRET,
  pages: {
    signIn: "/auth/sign-in",
    verifyRequest: "/auth/verify-request",
    // `error` is set so a failed sign-in lands on OUR page instead of NextAuth's
    // raw /api/auth/error (no message, no link back — a wall). The sign-in page
    // then reads the ?error= code and branches: AccessDenied (the admin gate
    // below refusing a non-admin) redirects to /auth/waitlist, while Verification
    // (an expired magic link) gets a "send a fresh one" notice. ONE url serves
    // every code that reaches it — verified in the installed next-auth v4,
    // core/index.js `case "error"` — so the branching is mandatory, not a nicety.
    // See lib/auth-error.ts.
    error: "/auth/sign-in",
  },
  callbacks: {
    signIn({ user }) {
      const email = user?.email?.toLowerCase();
      if (!email || email !== adminEmail) {
        console.warn("[auth] rejected non-admin sign-in attempt");
        return false;
      }
      return true;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.email = token.email ?? session.user.email;
        if (token.sub) {
          (session.user as { id?: string }).id = token.sub;
        }
      }
      return session;
    },
  },
};
