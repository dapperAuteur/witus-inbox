import { test, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

// Tutorial-as-test harness (witus plan 30 §8.3), copied from the witus repo — the reference. A tutorial is an ordered list of steps; each step has a
// `title` (becomes the doc heading), a `narration` (the line BAM records — see
// witus plans/31-tutorial-narration-scripts.md), and an `action` that drives the page. Running a tutorial
// under playwright.tutorial.config.ts produces, per flow, in tutorial-output/<slug>/:
//   marks.json   — [{ n, title, narration, startMs, endMs }] for every step, plus `flashes`: how
//                  many boundary flashes the video must contain (see syncFlash below)
//   step-NN.png  — a full-page screenshot at the END of each step
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
   *  Create one with: npx playwright codegen --channel chrome <prod-url> --save-storage=.auth/tutorial-user.json */
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

// The recorded webm does not keep this file's clock. Measured 2026-09-21 on three runs of the same
// tutorial: the video omitted the ~2 s page load, then ran at about 76% of wall time, by a
// different amount each run — so startMs/endMs cannot be used to cut it, and no offset or drift
// correction is stable. Instead the step boundaries are written INTO the video: the viewport
// flashes a colour no page uses before step 1 and after every step, and compose.mjs cuts on the
// flashes it finds. The flashes sit between segments, so none reaches a composed video.
// startMs/endMs stay in marks.json as a human-readable record, not as cut points.
async function syncFlash(page: Page): Promise<void> {
  const flash = () =>
    page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const el = document.createElement("div");
          // CSSOM assignment, not a style attribute — allowed under a strict style-src CSP.
          // pointer-events:none keeps hover state (open menus, tooltips) on the element beneath.
          el.style.cssText =
            "position:fixed;inset:0;z-index:2147483647;background:#ff00ff;pointer-events:none";
          document.documentElement.appendChild(el);
          requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              setTimeout(() => {
                el.remove();
                resolve();
              }, 240),
            ),
          );
        }),
    );
  try {
    await flash();
  } catch {
    // A step that ends mid-navigation destroys the execution context; the new page takes it.
    await page.waitForLoadState("domcontentloaded");
    await flash();
  }
  // Let the page repaint before anything that will be kept starts.
  await page.waitForTimeout(200);
}

export function defineTutorial(opts: TutorialOptions, steps: TutorialStep[]): void {
  test(`tutorial: ${opts.title}`, async ({ page }) => {
    test.skip(
      Boolean(opts.requiresAuth) && !process.env.TUTORIAL_STORAGE_STATE,
      "requires TUTORIAL_STORAGE_STATE (signed-in storage state) — see the requiresAuth option above",
    );
    const outDir = path.join(OUTPUT_ROOT, opts.slug);
    fs.mkdirSync(outDir, { recursive: true });

    const marks: Mark[] = [];
    const t0 = Date.now();

    await page.goto(opts.startPath ?? "/");
    await syncFlash(page);

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
      await syncFlash(page);
    }

    // The video file is finalized only after the page closes; record its path now and let the
    // composer resolve it after the run.
    const videoPath = await page.video()?.path();
    fs.writeFileSync(
      path.join(outDir, "marks.json"),
      JSON.stringify({ slug: opts.slug, title: opts.title, videoPath, flashes: marks.length + 1, steps: marks }, null, 2),
    );
  });
}
