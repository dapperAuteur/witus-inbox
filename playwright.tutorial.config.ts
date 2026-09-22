import { defineConfig, devices } from "@playwright/test";

// Recording profile for tutorials (witus plan 30 §8.3; harness contract in e2e/tutorials/tutorial.ts).
// Ported from flashlearn-ai. Separate from playwright.config.ts on purpose: the CI gate wants
// speed; a recording wants one worker, pacing inside each step, a fixed 1280×720 frame, and video on. Run:
//   TUTORIAL_STORAGE_STATE=.auth/tutorial-admin.json \
//   PLAYWRIGHT_BASE_URL=https://inbox.witus.online npm run tutorial:record
// The storage state is a signed-in session (npx playwright codegen <url> --save-storage=...).
// For this repo that session must be the ADMIN_EMAIL account — every /inbox surface is gated to
// it. .auth/ is gitignored — never commit a session.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e/tutorials",
  testMatch: "**/*.tutorial.ts",
  timeout: 300_000,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
    viewport: { width: 1280, height: 720 },
    video: { mode: "on", size: { width: 1280, height: 720 } },
    // Recording sessions are synthetic traffic too — same tag as the CI suite, so Honeycomb and
    // analytics can separate tutorial takes from real users (tag, not a drop: traces still flow).
    extraHTTPHeaders: { "x-witus-origin-test": "playwright-synthetic" },
    // slowMo is OFF by default, deliberately. It delays every browser protocol message, and the
    // screencast frames the recorder is built from are protocol messages: at slowMo 350 the webm
    // dropped to a few frames a second, lost whole stretches of wall time, and missed boundary
    // flashes (measured in the witus repo, 2026-09-21), so steps were cut in the wrong places.
    // Pace a tutorial inside its steps instead — page.waitForTimeout(), or
    // locator.pressSequentially(text, { delay }) for typing that should be readable.
    // TUTORIAL_SLOWMO exists for debugging a spec by eye, never for a take you will publish.
    launchOptions: { slowMo: Number(process.env.TUTORIAL_SLOWMO ?? 0) },
    ...(process.env.TUTORIAL_STORAGE_STATE ? { storageState: process.env.TUTORIAL_STORAGE_STATE } : {}),
    // Playwright's bundled chromium does not support macOS 13 (same note as playwright.config.ts);
    // local recordings drive the installed Google Chrome.
    ...(process.env.CI ? {} : { channel: "chrome" as const }),
  },
  projects: [{ name: "recording", use: { ...devices["Desktop Chrome"] } }],
});
