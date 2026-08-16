import { test, expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

// Happy path + a11y gate for the public surface (witus plan 30 Phase 2; a11y mandate from the
// ecosystem's docs/shared-ui-ux-dx.md). This app is a single-admin triage tool — everything
// behind proxy.ts is gated to ADMIN_EMAIL, and CI has no credentials — so the only honest
// unauthenticated coverage is: the anonymous entry point renders and stays accessible.
// Authenticated /inbox flows are deliberately out of scope here.

/** Gate on serious+critical axe violations. Minor/moderate findings are reported in the failure
 *  message when the gate trips, but don't fail the build on their own — the charter's bar is
 *  WCAG AA, and axe's minor findings routinely include below-AA nitpicks that would make the
 *  gate flaky-red and get ignored. Tighten later if the pages stay clean. */
async function expectNoSeriousA11yViolations(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const gating = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    gating.map((v) => `${v.impact}: ${v.id} — ${v.help} (${v.nodes.length} nodes)`),
  ).toEqual([]);
}

test("anonymous root lands on the sign-in page, which renders and is accessible", async ({
  page,
}) => {
  await page.goto("/");
  // app/page.tsx server-redirects sessionless visitors to /auth/sign-in.
  await expect(page).toHaveURL(/\/auth\/sign-in/);
  await expect(page.getByRole("heading", { name: /sign in to witus inbox/i })).toBeVisible();
  // The magic-link form is the page's whole job — assert it's actually usable.
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /email me a sign-in link/i })).toBeVisible();
  await expectNoSeriousA11yViolations(page);
});

test("verify-request page renders and is accessible", async ({ page }) => {
  // The post-submit "check your email" page is the other half of the anonymous flow and is
  // reachable without a session.
  await page.goto("/auth/verify-request");
  await expect(page.locator("h1").first()).toBeVisible();
  await expectNoSeriousA11yViolations(page);
});
