#!/usr/bin/env node
/**
 * Save a signed-in browser session for the tutorial recordings, then prove it works.
 *
 *   npm run tutorial:auth --              # list the profiles
 *   npm run tutorial:auth -- acme         # sign in, save, verify
 *   npm run tutorial:auth -- acme --check # verify a session saved earlier, no browser
 *
 * Why a script rather than a bare `playwright codegen` line: codegen happily writes a storage
 * state for a browser that never signed in, and the failure only shows up later as a tutorial
 * that silently SKIPS or films a logged-out page. This verifies the saved cookies by asking the
 * real site for a page that requires a session, so a bad take is caught in the ten seconds after
 * you close the window rather than in tomorrow's recording.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const PROFILES = {
  admin: {
    who: "the ADMIN_EMAIL account — every /inbox surface is gated to it",
    url: "https://inbox.witus.online",
    file: ".auth/tutorial-admin.json",
    // 307 to /auth/sign-in when signed out.
    gated: "/inbox",
    signInPath: "/auth/sign-in",
  },
};

const [profileName, ...flags] = process.argv.slice(2);
const checkOnly = flags.includes("--check");

if (!profileName || !PROFILES[profileName]) {
  console.log("Profiles:\n");
  for (const [name, p] of Object.entries(PROFILES)) {
    console.log(`  ${name.padEnd(8)} ${p.url}\n           sign in as ${p.who}\n           saves ${p.file}\n`);
  }
  console.log("Run: npm run tutorial:auth -- <profile>");
  process.exit(profileName ? 1 : 0);
}

const p = PROFILES[profileName];
const file = path.resolve(p.file);
fs.mkdirSync(path.dirname(file), { recursive: true });

if (!checkOnly) {
  console.log(`\n${"=".repeat(78)}`);
  console.log(`Sign in as: ${p.who}`);
  console.log(`Site:       ${p.url}`);
  console.log(`Saves to:   ${p.file}  (gitignored — never commit a session)`);
  if (p.note) console.log(`Note:       ${p.note}`);
  console.log(`${"=".repeat(78)}`);
  console.log(`
  1. A Chrome window and a small "Playwright Inspector" window open.
  2. Sign in in the Chrome window, the way you normally would.
     Magic link: type the email, open the link from your inbox, and come back to
     the SAME Chrome window. The link may open your usual browser instead — if it
     does, copy it and paste it into the Playwright Chrome window's address bar.
  3. Wait until you are properly signed in and can see a page only you can see.
  4. CLOSE THE CHROME WINDOW. Closing it is what writes the file.
     (Ignore the code the Inspector records. This script wants the session, not the code.)
  5. This script then checks the session and prints the line to use when recording.
`);

  const bin = path.resolve("node_modules/.bin/playwright");
  if (!fs.existsSync(bin)) {
    console.error("playwright is not installed in this repo — run the install first.");
    process.exit(1);
  }
  const res = spawnSync(bin, ["codegen", "--channel", "chrome", `--save-storage=${file}`, p.url], {
    stdio: "inherit",
  });
  if (res.error) {
    console.error(`\nCould not start Playwright: ${res.error.message}`);
    process.exit(1);
  }
}

if (!fs.existsSync(file)) {
  console.error(`\nFAILED: ${p.file} was not written. Closing the Chrome window is what saves it.`);
  process.exit(1);
}

const state = JSON.parse(fs.readFileSync(file, "utf8"));
const host = new URL(p.url).hostname;
const cookies = (state.cookies ?? []).filter(
  (c) => host === c.domain || host.endsWith(c.domain.replace(/^\./, "")) || c.domain.endsWith(host),
);
if (cookies.length === 0) {
  console.error(`\nFAILED: no cookies for ${host} in ${p.file}. The browser never signed in.`);
  process.exit(1);
}

// Ask the site for a page that requires a session. A redirect to the sign-in path means the
// cookies are not a signed-in session, whatever the file looks like.
const target = new URL(p.gated, p.url);
const res = await fetch(target, {
  redirect: "manual",
  headers: {
    cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; "),
    "x-witus-origin-test": "playwright-synthetic",
  },
});
const location = res.headers.get("location") ?? "";
let bounced = location.includes(p.signInPath) || (res.status >= 300 && res.status < 400 && location.includes("login"));
// A page that answers 200 to everyone would prove nothing, so also read it: the sign-in form's
// own words mean this is the login page wearing the gated page's URL.
let body = "";
if (res.status === 200) {
  body = await res.text();
  // A page that answers 200 to everyone proves nothing, so read it: the sign-in form's own words
  // mean this is the login page wearing the gated page's URL.
  if (!bounced) bounced = /Email me a sign-in link|No password, we email you/i.test(body);
}

console.log(`\ncookies saved: ${cookies.length}   ${p.gated} -> ${res.status}${location ? ` ${location}` : ""}`);
if (!bounced && p.expectBody && res.status === 200) {
  if (!body.includes(p.expectBody)) {
    console.error(`FAILED: ${p.gated} answered, but without ${p.expectBodyLabel ?? p.expectBody}.`);
    console.error("        You are signed in as the wrong account for this profile.");
    process.exit(1);
  }
}

if (bounced || res.status === 401 || res.status === 403) {
  console.error(`FAILED: ${p.gated} still bounces to sign-in. The session did not save — run it again and`);
  console.error("        make sure you are signed in BEFORE you close the Chrome window.");
  process.exit(1);
}

const expiries = cookies.map((c) => c.expires).filter((e) => typeof e === "number" && e > 0);
if (expiries.length) {
  const days = Math.round((Math.min(...expiries) * 1000 - Date.now()) / 86_400_000);
  console.log(`earliest cookie expiry: about ${days} day(s) away`);
}
console.log(`\nPASSED. Record with:\n  TUTORIAL_STORAGE_STATE=${p.file} PLAYWRIGHT_BASE_URL=${p.url} npm run tutorial:record -- <spec>\n`);
