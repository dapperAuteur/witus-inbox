import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

type InboxDb = NeonHttpDatabase<typeof schema>;

let cached: InboxDb | null = null;

export function getDb(): InboxDb {
  if (cached) return cached;
  const sql = neon(getEnv().DATABASE_URL);
  cached = drizzle(sql, { schema });
  return cached;
}

export type Db = InboxDb;
