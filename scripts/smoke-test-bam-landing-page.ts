/**
 * Smoke test the bam-landing-page source.
 *
 * Reads the local Inbox dev URL and the bam-landing-page hmac_secret from
 * INGEST_SOURCES, signs a sample payload exactly the way the bam-landing-page
 * sender does, and POSTs it. Prints PASS/FAIL with the receiver's response.
 *
 * Usage:
 *   npm run smoke:bam-landing-page
 *
 * Environment:
 *   INBOX_URL          Defaults to http://localhost:3000/api/ingest. Override
 *                      to point at the deployed Inbox (e.g. preview URL).
 *   INGEST_SOURCES     JSON array, must include an entry with slug
 *                      "bam-landing-page" and the matching hmac_secret.
 *                      Auto-loaded from .env.local via dotenv.
 */
import { config as loadEnv } from "dotenv";
import { createHmac } from "node:crypto";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

const INBOX_URL = process.env.INBOX_URL ?? "http://localhost:3000/api/ingest";
const SOURCE_SLUG = "bam-landing-page";

function loadSecretFromIngestSources(): string {
  const raw = process.env.INGEST_SOURCES;
  if (!raw) throw new Error("INGEST_SOURCES not set in env");
  let parsed: Array<{ slug: string; hmac_secret: string }>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("INGEST_SOURCES is not valid JSON");
  }
  const entry = parsed.find((e) => e.slug === SOURCE_SLUG);
  if (!entry) {
    throw new Error(
      `INGEST_SOURCES has no entry with slug=${SOURCE_SLUG}. Found: ${parsed.map((e) => e.slug).join(", ")}`
    );
  }
  return entry.hmac_secret;
}

async function main() {
  const secret = loadSecretFromIngestSources();
  const body = {
    form_type: "hire",
    submitter_email: "smoke-test@example.com",
    submitter_name: "Smoke Test",
    priority: "normal",
    payload: {
      name: "Smoke Test",
      email: "smoke-test@example.com",
      role_or_title: "Test role",
      company: "Test co",
      link: "",
      message: "Smoke test from witus-inbox/scripts/smoke-test-bam-landing-page.ts",
      source: "smoke-test",
      campaign: "",
    },
  };
  const rawBody = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  const res = await fetch(INBOX_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Witus-Source": SOURCE_SLUG,
      "X-Witus-Timestamp": timestamp,
      "X-Witus-Signature": `sha256=${signature}`,
    },
    body: rawBody,
  });

  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* leave as text */
  }

  if (res.ok) {
    console.log(`PASS — ${res.status} ${JSON.stringify(parsed)}`);
    process.exit(0);
  }
  console.error(`FAIL — ${res.status} ${JSON.stringify(parsed)}`);
  console.error(`URL:  ${INBOX_URL}`);
  console.error(`Slug: ${SOURCE_SLUG}`);
  console.error(
    `Common causes: 401 = signature mismatch (env secret differs from script-loaded secret); ` +
      `401 = unknown source (slug not in INGEST_SOURCES); ` +
      `400 = bad JSON or schema; ` +
      `connection refused = Inbox dev server not running on ${INBOX_URL}.`
  );
  process.exit(1);
}

main().catch((err) => {
  console.error("FAIL — script error:", err instanceof Error ? err.message : err);
  process.exit(2);
});
