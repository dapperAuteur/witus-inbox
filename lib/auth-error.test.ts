import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WAITLIST_PATH, authErrorAction, errorCodeFromSearchParams } from "./auth-error";

/**
 * Where a failed sign-in goes.
 *
 * The expensive failure pinned here is a REGRESSION OF THE MAGIC-LINK FLOW.
 * `pages.error` is a single URL for every failure that reaches it, and in the
 * installed next-auth v4 (core/index.js, `case "error"`) both AccessDenied — the
 * admin gate refusing a non-admin — and Verification — an expired or already-used
 * magic link — land on it. If the sign-in page routed the whole page to the
 * waitlist, an admin whose link merely expired would be told they have no access.
 * So the code is read and branched on, and that branching is pinned below.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf-8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("AccessDenied goes to the waitlist and asks", () => {
  it("redirects, rather than rendering a dead end", () => {
    expect(authErrorAction("AccessDenied")).toEqual({
      kind: "redirect",
      to: WAITLIST_PATH,
    });
  });

  it("lands on a page that offers to join, wired to an endpoint that really records", () => {
    const page = stripComments(read("app/auth/waitlist/page.tsx"));
    expect(page).toContain("WaitlistJoinForm");

    const form = stripComments(read("components/WaitlistJoinForm.tsx"));
    expect(form).toContain('fetch("/api/waitlist"');
    expect(form).toMatch(/method:\s*"POST"/);
    // "You're on the list" is only reachable after the API said ok — never a form
    // that pretends to record something it dropped.
    expect(form).toMatch(/if \(!res\.ok\)[\s\S]*?return;/);
    expect(form).toContain("setJoined(true)");

    const route = stripComments(read("app/api/waitlist/route.ts"));
    // It writes into the submissions queue this app already exists to serve —
    // no second waitlist mechanism was invented.
    expect(route).toContain("db.insert(submissions)");
    expect(route).toContain('formType: FORM_TYPE');
    // Idempotent on the address, so a repeat submission is not another row in
    // BAM's queue.
    expect(route).toMatch(/existing\.length > 0/);
    // Never log the submitter's address via a Drizzle error object.
    expect(route).toMatch(/err instanceof Error \? err\.name/);
  });

  it("keeps the waitlist surface public — a refused visitor has no session by definition", () => {
    const proxy = stripComments(read("proxy.ts"));
    expect(proxy).not.toMatch(/waitlist/);
    // The matcher gates only these three prefixes; /auth/* and /api/waitlist are
    // outside all of them.
    expect(proxy).toContain('"/inbox/:path*"');
    expect(proxy).toContain('"/api/submissions/:path*"');
    expect(proxy).toContain('"/api/inbox/:path*"');
  });
});

describe("the magic-link flow does not regress into a waitlist pitch", () => {
  it("tells an expired link apart from a refused account", () => {
    const action = authErrorAction("Verification");
    expect(action?.kind).toBe("notice");
    if (action?.kind !== "notice") throw new Error("unreachable");
    expect(action.title).toMatch(/expired/i);
    expect(action.body).toMatch(/fresh one/i);
    // The word that must never appear on this branch.
    expect(`${action.title} ${action.body}`).not.toMatch(/waitlist/i);
  });

  it("never redirects anything but AccessDenied", () => {
    // Every client-visible v4 code, from core/index.js's `case "error"` list plus
    // the ones that reach pages.error directly.
    const codes = [
      "Verification",
      "Configuration",
      "Default",
      "Signin",
      "OAuthSignin",
      "OAuthCallback",
      "OAuthCreateAccount",
      "EmailCreateAccount",
      "Callback",
      "OAuthAccountNotLinked",
      "EmailSignin",
      "CredentialsSignin",
      "SessionRequired",
      "SomethingNextAuthAddsLater",
    ];
    for (const code of codes) {
      expect(authErrorAction(code)?.kind).toBe("notice");
    }
  });

  it("gives an unknown code a notice rather than silence", () => {
    // A sign-in page that looks untouched after a failed sign-in is the wall this
    // change removes.
    expect(authErrorAction("TotallyNewCode")).toEqual({
      kind: "notice",
      title: "Sign-in did not complete",
      body: "Something went wrong on the way back. Try again, or use the email form above.",
    });
  });

  it("does nothing at all when there is no error on the URL", () => {
    for (const code of [null, undefined, "", "   "]) {
      expect(authErrorAction(code)).toBeNull();
    }
  });
});

describe("reading the code off the URL", () => {
  it("takes the first value when Next hands over a repeated param", () => {
    expect(errorCodeFromSearchParams({ error: ["AccessDenied", "Verification"] })).toBe(
      "AccessDenied",
    );
  });

  it("treats absent, empty, and non-string as no error", () => {
    expect(errorCodeFromSearchParams(undefined)).toBeNull();
    expect(errorCodeFromSearchParams({})).toBeNull();
    expect(errorCodeFromSearchParams({ error: "" })).toBeNull();
    expect(errorCodeFromSearchParams({ error: [] })).toBeNull();
  });
});

describe("the config actually routes failures here", () => {
  it("points pages.error at the sign-in page", () => {
    const auth = stripComments(read("lib/auth.ts"));
    expect(auth).toMatch(/error:\s*"\/auth\/sign-in"/);
  });

  it("makes the sign-in page act on the code instead of ignoring it", () => {
    const page = stripComments(read("app/auth/sign-in/page.tsx"));
    expect(page).toContain("authErrorAction");
    expect(page).toContain("errorCodeFromSearchParams");
    expect(page).toContain("redirect(action.to)");
  });
});
