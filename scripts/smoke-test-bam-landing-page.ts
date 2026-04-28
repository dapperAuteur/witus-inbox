/**
 * Smoke test the bam-landing-page source.
 *
 * Looks up the bam-landing-page hmac_secret from INGEST_SOURCES, then calls
 * the canonical sender library at examples/sender.ts to POST a fixture
 * payload and prints PASS/FAIL.
 *
 * Usage:
 *   npm run smoke:bam-landing-page
 *
 * Environment:
 *   INBOX_URL       Defaults to http://localhost:3000/api/ingest. Override
 *                   to point at a deployed Inbox (e.g. preview URL).
 *   INGEST_SOURCES  JSON array, must include an entry with slug
 *                   "bam-landing-page". Auto-loaded from .env.local.
 */
import { config as loadEnv } from "dotenv";
import { sendToInbox } from "../examples/sender";

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
  const result = await sendToInbox({
    inboxUrl: INBOX_URL,
    sourceSlug: SOURCE_SLUG,
    hmacSecret: loadSecretFromIngestSources(),
    submission: {
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
    },
  });

  if (result.ok) {
    console.log(`PASS — ${result.status} {"ok":true,"id":"${result.id}"}`);
    process.exit(0);
  }
  console.error(`FAIL — ${result.status} ${result.detail ?? ""}`);
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
