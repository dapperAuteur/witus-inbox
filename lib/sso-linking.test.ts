import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { NextAuthOptions } from "next-auth";
import {
  WITUS_EMAIL_UNVERIFIED_REDIRECT,
  WITUS_PROVIDER_ID,
  isEmailVerifiedClaim,
  normalizeEmail,
  witusSignInCheck,
} from "./sso-linking";
import { authErrorAction } from "./auth-error";

/**
 * "Sign in with WitUS" account linking (bug, 2026-10-29): the owner's email-created
 * account must link to the WitUS identity on first SSO sign-in, but only when the
 * IdP asserts a verified email, and only for the WitUS provider.
 */

describe("the email_verified claim", () => {
  it("is verified only for the boolean true", () => {
    expect(isEmailVerifiedClaim({ email_verified: true })).toBe(true);
    for (const value of [false, "true", 1, null, undefined, {}]) {
      expect(isEmailVerifiedClaim({ email_verified: value })).toBe(false);
    }
    expect(isEmailVerifiedClaim({})).toBe(false);
    expect(isEmailVerifiedClaim(null)).toBe(false);
    expect(isEmailVerifiedClaim(undefined)).toBe(false);
  });
});

describe("the provider-specific sign-in check", () => {
  it("lets a WitUS sign-in with a verified email continue to the admin gate", () => {
    expect(witusSignInCheck(WITUS_PROVIDER_ID, { email_verified: true })).toBe(true);
  });

  it("stops a WitUS sign-in without a verified email, with its own notice", () => {
    expect(witusSignInCheck(WITUS_PROVIDER_ID, { email_verified: false })).toBe(
      WITUS_EMAIL_UNVERIFIED_REDIRECT,
    );
    expect(witusSignInCheck(WITUS_PROVIDER_ID, {})).toBe(WITUS_EMAIL_UNVERIFIED_REDIRECT);
  });

  it("does not touch other providers (the magic-link email provider has no claim)", () => {
    expect(witusSignInCheck("email", undefined)).toBe(true);
  });

  it("redirects to a notice, never to the waitlist", () => {
    const code = new URL(WITUS_EMAIL_UNVERIFIED_REDIRECT, "https://x.invalid").searchParams.get(
      "error",
    );
    const action = authErrorAction(code);
    expect(action?.kind).toBe("notice");
    if (action?.kind !== "notice") throw new Error("unreachable");
    expect(action.title).toMatch(/not verified/i);
  });
});

describe("email normalization", () => {
  it("lowercases and trims so the adapter's exact-match lookup finds the existing user", () => {
    expect(normalizeEmail("  Owner@Example.COM ")).toBe("owner@example.com");
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });
});

describe("the real auth config", () => {
  const ADMIN = "owner@example.com";
  let authOptions: NextAuthOptions;

  beforeAll(async () => {
    // Stub values: lib/env.ts validates shape only, and @neondatabase/serverless
    // does not connect until a query runs, so nothing here touches a database.
    vi.stubEnv("STORAGE_DATABASE_URL", "postgresql://stub:stub@stub.invalid:5432/stub");
    vi.stubEnv("NEXTAUTH_SECRET", "test-secret-placeholder-1234567890");
    vi.stubEnv("EMAIL_SERVER", "smtp://nobody:none@localhost:25");
    vi.stubEnv("EMAIL_FROM", "WitUS Inbox <inbox@example.com>");
    vi.stubEnv("ADMIN_EMAIL", ADMIN);
    vi.stubEnv("WITUS_OIDC_CLIENT_ID", "inbox");
    vi.stubEnv("WITUS_OIDC_CLIENT_SECRET", "test-client-secret");
    vi.resetModules();
    ({ authOptions } = await import("./auth"));
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("enables email account linking on the WitUS provider and on no other", () => {
    const linking = Object.fromEntries(
      authOptions.providers.map((p) => [
        p.id,
        (p as { allowDangerousEmailAccountLinking?: boolean }).allowDangerousEmailAccountLinking ??
          false,
      ]),
    );
    expect(linking).toEqual({ email: false, [WITUS_PROVIDER_ID]: true });
  });

  it("lowercases the WitUS email in the mapped profile", () => {
    const witus = authOptions.providers.find((p) => p.id === WITUS_PROVIDER_ID) as unknown as {
      profile: (p: Record<string, unknown>) => { email: string | null };
    };
    expect(witus.profile({ sub: "abc", email: "Owner@Example.com", email_verified: true }).email).toBe(
      ADMIN,
    );
  });

  type SignIn = (args: {
    user: { id: string; email: string | null };
    account: { provider: string; type: string; providerAccountId: string } | null;
    profile?: Record<string, unknown>;
  }) => Promise<boolean | string> | boolean | string;

  const signIn =
    () =>
    async (...args: Parameters<SignIn>) =>
      (authOptions.callbacks!.signIn as unknown as SignIn)(...args);
  const witusAccount = { provider: WITUS_PROVIDER_ID, type: "oauth", providerAccountId: "abc" };

  it("allows the owner via WitUS when the email is verified", async () => {
    await expect(
      signIn()({
        user: { id: "abc", email: ADMIN },
        account: witusAccount,
        profile: { sub: "abc", email: ADMIN, email_verified: true },
      }),
    ).resolves.toBe(true);
  });

  it("refuses the owner's address via WitUS when the email is NOT verified", async () => {
    await expect(
      signIn()({
        user: { id: "abc", email: ADMIN },
        account: witusAccount,
        profile: { sub: "abc", email: ADMIN, email_verified: false },
      }),
    ).resolves.toBe(WITUS_EMAIL_UNVERIFIED_REDIRECT);
  });

  it("still refuses a verified non-admin (the admin gate is unchanged)", async () => {
    await expect(
      signIn()({
        user: { id: "xyz", email: "someone@example.com" },
        account: { ...witusAccount, providerAccountId: "xyz" },
        profile: { sub: "xyz", email: "someone@example.com", email_verified: true },
      }),
    ).resolves.toBe(false);
  });

  it("leaves the magic-link email sign-in as it was", async () => {
    await expect(
      signIn()({
        user: { id: ADMIN, email: ADMIN },
        account: { provider: "email", type: "email", providerAccountId: ADMIN },
      }),
    ).resolves.toBe(true);
  });
});
