import { test, expect } from "@playwright/test";

// Post-deploy smoke (@smoke): the production workflow job runs ONLY tests tagged @smoke, so keep
// this file to checks that are safe and meaningful against live production. /api/health runs a
// real `select 1` against the database and returns 503 fast when it's unreachable (see
// app/api/health/route.ts), so a green here means "deployed AND serving real data", which is the
// whole point of the gate.
test("@smoke health endpoint answers ok", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.service).toBe("witus-inbox");
  // checkedAt is a fresh ISO timestamp on every hit (the route is force-dynamic + no-store).
  expect(typeof body.checkedAt).toBe("string");
  expect(Number.isNaN(Date.parse(body.checkedAt))).toBe(false);
});

// This app has no public homepage: app/page.tsx redirects anonymous visitors to /auth/sign-in
// (authenticated admins go to /inbox, which CI can never be). "Serves" for an anonymous smoke
// check therefore means "the redirect lands on the sign-in page and it renders".
test("@smoke anonymous root serves the sign-in page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/auth\/sign-in/);
  await expect(page.locator("h1").first()).toBeVisible();
});
