import "server-only";
import { z } from "zod";
import { getEnv } from "./env";

const SourceEntry = z.object({
  slug: z.string().min(1),
  hmac_secret: z
    .string()
    .min(32, "hmac_secret must be at least 32 chars; generate via `openssl rand -hex 32`"),
});
const SourcesSchema = z.array(SourceEntry);

let cached: Map<string, string> | null = null;

function loadSources(): Map<string, string> {
  if (cached) return cached;
  const raw = getEnv().INGEST_SOURCES;
  const map = new Map<string, string>();
  if (!raw) {
    cached = map;
    return map;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("[ingest-sources] INGEST_SOURCES is not valid JSON");
    cached = map;
    return map;
  }
  const result = SourcesSchema.safeParse(parsed);
  if (!result.success) {
    console.error("[ingest-sources] INGEST_SOURCES schema invalid");
    cached = map;
    return map;
  }
  for (const entry of result.data) {
    map.set(entry.slug, entry.hmac_secret);
  }
  cached = map;
  return map;
}

export function getSourceSecret(slug: string): string | null {
  return loadSources().get(slug) ?? null;
}

/**
 * Returns every slug currently configured in `INGEST_SOURCES`, sorted.
 * Used by the inbox UI to surface ecosystem apps in the source filter even
 * before they have submitted anything — so a newly-added sibling appears
 * the moment its secret is provisioned, not the moment its first webhook
 * lands.
 */
export function listConfiguredSourceSlugs(): string[] {
  return Array.from(loadSources().keys()).sort();
}
