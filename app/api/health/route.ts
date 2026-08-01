import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Liveness budget. A hung database must fail fast so an uptime monitor sees a
 * 503 instead of timing out on its own side. Neon HTTP queries normally answer
 * in tens of milliseconds, so 4s is generous.
 */
const DB_TIMEOUT_MS = 4_000;

const NO_STORE_HEADERS = {
  "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
} as const;

class HealthTimeoutError extends Error {
  constructor() {
    super("timeout");
    this.name = "HealthTimeoutError";
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new HealthTimeoutError()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

/**
 * Public, unauthenticated health check for uptime monitors.
 *
 * Deliberate constraints, all security-relevant:
 *  - It runs a real `select 1` against the database. A static 200 would be
 *    exactly the false green this endpoint exists to prevent.
 *  - It NEVER echoes the caught error. A Neon/Drizzle connection failure
 *    routinely carries the connection string, which carries the password.
 *    Only the fixed token `database_unreachable` leaves the process; the
 *    server log gets the error's class name and nothing else.
 *  - It returns no submission data of any kind: no counts, no timestamps of
 *    the latest item, nothing implying volume. This app is the ecosystem
 *    triage inbox and holds other apps' names, emails, and free text.
 */
export async function GET(): Promise<NextResponse> {
  try {
    // getDb() can also throw (env validation); keep it inside the guard so no
    // env detail can escape either.
    await withTimeout(getDb().execute(sql`select 1`), DB_TIMEOUT_MS);
  } catch (err) {
    // Class name only. Never the message, stack, host, or query params.
    const code = err instanceof Error ? err.name : "UnknownError";
    console.error("[health] db check failed err=%s", code);
    return NextResponse.json(
      { ok: false, error: "database_unreachable" },
      { status: 503, headers: NO_STORE_HEADERS }
    );
  }

  return NextResponse.json(
    { ok: true, service: "witus-inbox", checkedAt: new Date().toISOString() },
    { status: 200, headers: NO_STORE_HEADERS }
  );
}
