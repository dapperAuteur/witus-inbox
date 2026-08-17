#!/usr/bin/env node
/**
 * Composes the narrated tutorial video (plan 30 §8.4 — BAM records the narration).
 *
 *   node scripts/tutorial-video/compose.mjs <slug> [--audio <dir>]
 *
 * Inputs:
 *   tutorial-output/<slug>/marks.json    — step timings + the recorded webm's path
 *   <audio dir>/step-NN.(wav|mp3|m4a)    — one narration file per step (default: audio/<slug>/)
 *                                          read the lines from plans/31-tutorial-narration-scripts.md
 * Output:
 *   docs/tutorials/video/<slug>.mp4
 *
 * Mechanics: each step's video segment is cut at its marks; if the step's narration audio runs
 * longer than the segment, the last frame is held (tpad clone) until the audio ends — so BAM can
 * re-record any single step at any length and re-run this script; the spec never changes. Steps
 * with no audio file keep their natural length, silent. Requires ffmpeg + ffprobe on PATH.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const args = process.argv.slice(2);
const slug = args[0];
if (!slug) {
  console.error("Usage: node scripts/tutorial-video/compose.mjs <slug> [--audio <dir>]");
  process.exit(1);
}
const audioFlag = args.indexOf("--audio");
const ROOT = process.cwd();
const runDir = path.join(ROOT, "tutorial-output", slug);
const audioDir = audioFlag !== -1 ? path.resolve(args[audioFlag + 1]) : path.join(ROOT, "audio", slug);
const outDir = path.join(ROOT, "docs", "tutorials", "video");
const marks = JSON.parse(fs.readFileSync(path.join(runDir, "marks.json"), "utf8"));

// marks.json stores the path reported DURING the test, but Playwright moves the artifact into
// test-results/<test-dir>/ when the test ends — so fall back to the newest webm under test-results.
function resolveVideo() {
  if (marks.videoPath && fs.existsSync(marks.videoPath)) return marks.videoPath;
  const trRoot = path.join(ROOT, "test-results");
  let best = null;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(".webm")) {
        const mtime = fs.statSync(p).mtimeMs;
        if (!best || mtime > best.mtime) best = { p, mtime };
      }
    }
  };
  if (fs.existsSync(trRoot)) walk(trRoot);
  if (!best) throw new Error("No recorded webm found — re-run the tutorial config first.");
  return best.p;
}
const video = resolveVideo();

const ffprobe = (file) =>
  parseFloat(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file])
      .toString()
      .trim(),
  );

const findAudio = (n) => {
  for (const ext of ["wav", "mp3", "m4a"]) {
    const f = path.join(audioDir, `step-${String(n).padStart(2, "0")}.${ext}`);
    if (fs.existsSync(f)) return f;
  }
  return null;
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `tut-${slug}-`));
const segments = [];

for (const step of marks.steps) {
  const segLen = (step.endMs - step.startMs) / 1000;
  const audio = findAudio(step.n);
  const audioLen = audio ? ffprobe(audio) : 0;
  const holdFor = Math.max(0, audioLen - segLen);
  const finalLen = Math.max(segLen, audioLen);
  const seg = path.join(tmp, `seg-${step.n}.mp4`);

  const vf = `tpad=stop_mode=clone:stop_duration=${holdFor.toFixed(3)}`;
  const cmd = [
    "-y", "-loglevel", "error",
    "-ss", (step.startMs / 1000).toFixed(3),
    "-t", segLen.toFixed(3),
    "-i", video,
    ...(audio ? ["-i", audio] : ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono"]),
    "-filter_complex", `[0:v]${vf},fps=30,format=yuv420p[v]`,
    "-map", "[v]", "-map", "1:a",
    "-t", finalLen.toFixed(3),
    "-c:v", "libx264", "-preset", "medium", "-crf", "20",
    "-c:a", "aac", "-b:a", "128k",
    seg,
  ];
  execFileSync("ffmpeg", cmd, { stdio: ["ignore", "ignore", "inherit"] });
  segments.push(seg);
  console.log(
    `step ${step.n}: video ${segLen.toFixed(1)}s, audio ${audioLen.toFixed(1)}s${audio ? "" : " (silent — no file)"} -> ${finalLen.toFixed(1)}s`,
  );
}

const listFile = path.join(tmp, "concat.txt");
fs.writeFileSync(listFile, segments.map((s) => `file '${s}'`).join("\n"));
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `${slug}.mp4`);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", out], {
  stdio: ["ignore", "ignore", "inherit"],
});
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${path.relative(ROOT, out)} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
