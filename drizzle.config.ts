import type { Config } from "drizzle-kit";
import "dotenv/config";

const migrationUrl =
  process.env.STORAGE_DATABASE_URL_UNPOOLED ?? process.env.STORAGE_DATABASE_URL;

if (!migrationUrl) {
  throw new Error(
    "STORAGE_DATABASE_URL_UNPOOLED (preferred) or STORAGE_DATABASE_URL is required to run drizzle-kit"
  );
}

export default {
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: migrationUrl,
  },
} satisfies Config;
