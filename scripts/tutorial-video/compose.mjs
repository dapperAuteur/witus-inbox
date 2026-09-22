#!/usr/bin/env node
/**
 * Composes the narrated tutorial video (plan 30 §8.4 — BAM records the narration).
 *
 *   node scripts/tutorial-video/compose.mjs <slug> [--audio <dir>] [--captions] [--out <dir>]
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
 *
 * Captions (plan 33 §7 — quick-reference clips are captioned, not narrated):
 *   --captions  each step's `narration` is its caption. Steps are held long enough to READ it
 *               (a silent step is otherwise as short as the click that made it), and two caption
 *               files are written beside the mp4: <slug>.srt for the YouTube upload and
 *               <slug>.vtt for a <track kind="captions"> on the app help pages. Captions are
 *               never drawn into the frame (BAM, 2026-09-21): the mp4 stays clean so captions
 *               remain toggleable, translatable and readable by screen readers.
 *   --out       output directory (default docs/tutorials/video).
 * Audio and captions compose: a narrated step is held for whichever is longer.
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
const outFlag = args.indexOf("--out");
const captions = args.includes("--captions");
const ROOT = process.cwd();
const runDir = path.join(ROOT, "tutorial-output", slug);
const audioDir = audioFlag !== -1 ? path.resolve(args[audioFlag + 1]) : path.join(ROOT, "audio", slug);
const outDir = outFlag !== -1 ? path.resolve(args[outFlag + 1]) : path.join(ROOT, "docs", "tutorials", "video");
const marks = JSON.parse(fs.readFileSync(path.join(runDir, "marks.json"), "utf8"));

// marks.json stores the path reported DURING the test, but Playwright moves the artifact into
// test-results/<spec-file>-<title>-<project>/ when the test ends. One recording run usually
// records SEVERAL tutorials, so "the newest webm" is the wrong video for all but the last of
// them. Match this slug's folder instead: by convention a spec is named <slug>.tutorial.ts, and
// Playwright keeps the start of the file name when it truncates a long folder name (about 26
// characters survive, hence the slice for long slugs).
function resolveVideo() {
  if (marks.videoPath && fs.existsSync(marks.videoPath)) return marks.videoPath;
  const trRoot = path.join(ROOT, "test-results");
  const prefix = slug.length > 24 ? slug.slice(0, 24) : `${slug}.`;
  let best = null;
  let bestAny = null;
  const walk = (dir, mine) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p, mine || entry.name.startsWith(prefix));
      else if (entry.name.endsWith(".webm")) {
        const mtime = fs.statSync(p).mtimeMs;
        if (mine && (!best || mtime > best.mtime)) best = { p, mtime };
        if (!bestAny || mtime > bestAny.mtime) bestAny = { p, mtime };
      }
    }
  };
  if (fs.existsSync(trRoot)) walk(trRoot, false);
  if (best) return best.p;
  if (!bestAny) throw new Error("No recorded webm found — re-run the tutorial config first.");
  console.warn(
    `warning: no test-results folder starts with "${prefix}" — using the newest webm, which is only ` +
      `right if this was the last tutorial recorded:\n  ${path.relative(ROOT, bestAny.p)}`,
  );
  return bestAny.p;
}
const video = resolveVideo();

// The webm does not keep the harness's clock (it drops the page load and runs slow, differently
// each run — see syncFlash in e2e/tutorials/tutorial.ts), so marks.json times cannot cut it. The
// harness flashes the viewport magenta before step 1 and after every step; step N is whatever the
// video shows between flash N-1 and flash N.
const FPS = 50;
function findFlashes() {
  // Average the top-left corner only: the recorder's first frames can be a smaller viewport
  // letterboxed into the 1280×720 frame, where a full-frame average dilutes the flash below
  // threshold. The corner is magenta in both cases, and no page paints a magenta corner.
  const raw = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", video, "-vf", `fps=${FPS},crop=160:90:0:0,scale=1:1:flags=area`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 256 * 1024 * 1024 },
  );
  const runs = [];
  let start = null;
  const frames = Math.floor(raw.length / 3);
  for (let i = 0; i <= frames; i++) {
    const magenta = i < frames && raw[i * 3] > 180 && raw[i * 3 + 1] < 90 && raw[i * 3 + 2] > 180;
    if (magenta && start === null) start = i;
    if (!magenta && start !== null) {
      runs.push({ start: start / FPS, end: i / FPS });
      start = null;
    }
  }
  return runs;
}

// Returns [{ start, len }] per step in VIDEO time, or null for a recording made before the harness
// flashed (cut on raw marks, with a warning: those cuts are known to be wrong by up to a second).
function stepWindows() {
  if (!marks.flashes) {
    console.warn(
      "warning: this recording has no boundary flashes (older harness) — cutting on marks.json times, " +
        "which the video does not keep. Re-record before publishing.",
    );
    return null;
  }
  const runs = findFlashes();
  if (runs.length !== marks.flashes) {
    throw new Error(
      `Expected ${marks.flashes} boundary flashes in the video, found ${runs.length}. Refusing to guess ` +
        "the cut points — re-record this tutorial.",
    );
  }
  // Trim a few frames inside each boundary: the flash fades in and out over a frame or two of
  // compression blur, and a held last frame with a magenta tint is worse than a slightly short step.
  const PAD_IN = 0.12;
  const PAD_OUT = 0.06;
  return marks.steps.map((_, i) => {
    const start = runs[i].end + PAD_IN;
    return { start, len: Math.max(0.2, runs[i + 1].start - PAD_OUT - start) };
  });
}
const windows = stepWindows();

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

// Reading time for a caption: ~60 ms per character, never under 2.5 s. Slower than a fluent
// reader needs on purpose — the viewer is also looking at the screen the caption describes.
const readLen = (text) => Math.max(2.5, text.length * 0.06);

const srtTime = (s) => {
  const ms = Math.round(s * 1000);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `tut-${slug}-`));
const segments = [];
const cues = [];
let cursor = 0;

for (const [i, step] of marks.steps.entries()) {
  const segStart = windows ? windows[i].start : step.startMs / 1000;
  const segLen = windows ? windows[i].len : (step.endMs - step.startMs) / 1000;
  const audio = findAudio(step.n);
  const audioLen = audio ? ffprobe(audio) : 0;
  const finalLen = Math.max(segLen, audioLen, captions ? readLen(step.narration) : 0);
  const holdFor = finalLen - segLen;
  const seg = path.join(tmp, `seg-${step.n}.mp4`);
  // Cue ends a beat early so consecutive captions visibly change rather than morph.
  cues.push(`${step.n}\n${srtTime(cursor)} --> ${srtTime(cursor + finalLen - 0.1)}\n${step.narration}\n`);
  cursor += finalLen;

  const vf = `tpad=stop_mode=clone:stop_duration=${holdFor.toFixed(3)}`;
  const cmd = [
    "-y", "-loglevel", "error",
    "-ss", Math.max(0, segStart).toFixed(3),
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

if (captions) {
  const srt = cues.join("\n");
  // WebVTT is SRT with a header, "." for the millisecond separator, and no cue numbers needed.
  const vtt = "WEBVTT\n\n" + srt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  for (const [ext, body] of [["srt", srt], ["vtt", vtt]]) {
    const f = path.join(outDir, `${slug}.${ext}`);
    fs.writeFileSync(f, body);
    console.log(path.relative(ROOT, f));
  }
}
