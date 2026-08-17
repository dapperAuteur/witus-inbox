import { test, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

// Tutorial-as-test harness (witus plan 30 §8.3), ported from flashlearn-ai. A tutorial is an
// ordered list of steps; each step has a `title` (becomes the doc heading), a `narration` (the
// line BAM records — see witus plans/31-tutorial-narration-scripts.md), and an `action` that
// drives the page. Running a tutorial under playwright.tutorial.config.ts produces, per flow,
// in tutorial-output/<slug>/:
//   marks.json   — [{ n, title, narration, startMs, endMs }] wall-clock timing of every step
//   step-NN.png  — a full-frame screenshot at the END of each step
//   video path   — recorded by the config (video: "on"); marks.json stores its location
// scripts/tutorial-video/gen-docs.mjs turns that into docs/tutorials/<slug>.md;
// scripts/tutorial-video/compose.mjs + BAM's step-NN audio files turn it into a narrated mp4.
//
// The narration field is part of the CONTRACT, not decoration: compose.mjs stretches each step's
// screen time to the length of its recorded audio, keyed by step number. Keep step order stable
// once audio is recorded; append rather than reorder.

export interface TutorialStep {
  title: string;
  narration: string;
  action: (page: Page) => Promise<void>;
}

export interface TutorialOptions {
  /** Kebab-case output folder name; also the docs/video basename. */
  slug: string;
  /** Human title for the doc page. */
  title: string;
  /** Path to open before step 1 (default "/"). */
  startPath?: string;
  /** Skip (don't fail) unless TUTORIAL_STORAGE_STATE points at a signed-in storage state.
   *  Create one with: npx playwright codegen <prod-url> --save-storage=.auth/tutorial-user.json */
  requiresAuth?: boolean;
}

interface Mark {
  n: number;
  title: string;
  narration: string;
  startMs: number;
  endMs: number;
}

const OUTPUT_ROOT = path.join(process.cwd(), "tutorial-output");

export function defineTutorial(opts: TutorialOptions, steps: TutorialStep[]): void {
  test(`tutorial: ${opts.title}`, async ({ page }) => {
    test.skip(
      Boolean(opts.requiresAuth) && !process.env.TUTORIAL_STORAGE_STATE,
      "requires TUTORIAL_STORAGE_STATE (signed-in storage state) — see e2e/tutorials/tutorial.ts header",
    );
    const outDir = path.join(OUTPUT_ROOT, opts.slug);
    fs.mkdirSync(outDir, { recursive: true });

    const marks: Mark[] = [];
    const t0 = Date.now();

    await page.goto(opts.startPath ?? "/");

    for (const [i, step] of steps.entries()) {
      const n = i + 1;
      const startMs = Date.now() - t0;
      await test.step(`${String(n).padStart(2, "0")} ${step.title}`, async () => {
        await step.action(page);
        // Settle briefly so the recording holds the finished state — the composer pads further to
        // match the narration audio, but a beat of stillness makes cuts look intentional.
        await page.waitForTimeout(600);
        await page.screenshot({
          path: path.join(outDir, `step-${String(n).padStart(2, "0")}.png`),
          fullPage: false,
        });
      });
      marks.push({ n, title: step.title, narration: step.narration, startMs, endMs: Date.now() - t0 });
    }

    // The video file is finalized only after the page closes; record its path now and let the
    // composer resolve it after the run.
    const videoPath = await page.video()?.path();
    fs.writeFileSync(
      path.join(outDir, "marks.json"),
      JSON.stringify({ slug: opts.slug, title: opts.title, videoPath, steps: marks }, null, 2),
    );
  });
}
