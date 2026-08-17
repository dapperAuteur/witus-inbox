#!/usr/bin/env node
/**
 * Turns a recorded tutorial run into a markdown tutorial with fresh screenshots.
 *
 *   node scripts/tutorial-video/gen-docs.mjs [slug ...]
 *
 * Reads  tutorial-output/<slug>/{marks.json,step-NN.png}  (produced by
 * `npx playwright test --config playwright.tutorial.config.ts`, see e2e/tutorials/tutorial.ts)
 * and writes docs/tutorials/<slug>.md + docs/tutorials/assets/<slug>/step-NN.png.
 *
 * Because the source of every screenshot and heading is the same spec that gates the flow in CI,
 * a tutorial regenerated after a UI change can never show a stale interface — the property
 * hand-made tutorials always lose (plan 30 §8.3). No args = every slug found in tutorial-output/.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = process.cwd();
const OUT_ROOT = path.join(ROOT, "tutorial-output");
const DOCS_ROOT = path.join(ROOT, "docs", "tutorials");

const slugs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.existsSync(OUT_ROOT)
    ? fs.readdirSync(OUT_ROOT).filter((d) => fs.existsSync(path.join(OUT_ROOT, d, "marks.json")))
    : [];

if (!slugs.length) {
  console.error("No recorded tutorials found. Run the tutorial config first:");
  console.error("  PLAYWRIGHT_BASE_URL=<url> npx playwright test --config playwright.tutorial.config.ts");
  process.exit(1);
}

for (const slug of slugs) {
  const runDir = path.join(OUT_ROOT, slug);
  const marks = JSON.parse(fs.readFileSync(path.join(runDir, "marks.json"), "utf8"));
  const assetDir = path.join(DOCS_ROOT, "assets", slug);
  fs.mkdirSync(assetDir, { recursive: true });

  const lines = [
    `# ${marks.title}`,
    "",
    `> Auto-generated from \`e2e/tutorials/${slug}.tutorial.ts\` — do not edit by hand.`,
    `> Regenerate: \`npx playwright test --config playwright.tutorial.config.ts\` then \`node scripts/tutorial-video/gen-docs.mjs ${slug}\`.`,
    "",
  ];

  for (const step of marks.steps) {
    const png = `step-${String(step.n).padStart(2, "0")}.png`;
    const src = path.join(runDir, png);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(assetDir, png));
    lines.push(`## ${step.n}. ${step.title}`, "", step.narration, "");
    if (fs.existsSync(src)) lines.push(`![${step.title}](./assets/${slug}/${png})`, "");
  }

  fs.mkdirSync(DOCS_ROOT, { recursive: true });
  const outFile = path.join(DOCS_ROOT, `${slug}.md`);
  fs.writeFileSync(outFile, lines.join("\n"));
  console.log(`${slug}: ${marks.steps.length} steps -> ${path.relative(ROOT, outFile)}`);
}
