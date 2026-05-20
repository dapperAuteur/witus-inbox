import { type NextRequest } from "next/server";
import { and, desc, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { submissions } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES = ["new", "in_progress", "replied", "waiting", "closed"] as const;
type Status = (typeof VALID_STATUSES)[number];

const MAX_ROWS = 10000;
const MAX_Q_LENGTH = 100;

const CSV_HEADER = [
  "id",
  "source",
  "form_type",
  "submitter_name",
  "submitter_email",
  "status",
  "priority",
  "received_at",
  "payload_json",
];

function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "string" ? value : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

function isoDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function dedupeNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const trimmed = v.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function escapeLike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/[%_]/g, "\\$&");
}

export async function GET(request: NextRequest): Promise<Response> {
  const url = new URL(request.url);
  const sourceFilters = dedupeNonEmpty(url.searchParams.getAll("source"));
  const formTypeFilters = dedupeNonEmpty(url.searchParams.getAll("form_type"));
  const statusRaw = url.searchParams.get("status");
  const statusFilter: Status | undefined = VALID_STATUSES.find((s) => s === statusRaw);
  const q = url.searchParams.get("q")?.trim().slice(0, MAX_Q_LENGTH) || "";

  const conditions: SQL[] = [];
  if (sourceFilters.length > 0) {
    conditions.push(inArray(submissions.source, sourceFilters));
  }
  if (formTypeFilters.length > 0) {
    conditions.push(inArray(submissions.formType, formTypeFilters));
  }
  if (statusFilter) {
    conditions.push(eq(submissions.status, statusFilter));
  }
  if (q) {
    const pattern = `%${escapeLike(q)}%`;
    const fuzzy = or(
      ilike(submissions.submitterName, pattern),
      ilike(submissions.submitterEmail, pattern)
    );
    if (fuzzy) conditions.push(fuzzy);
  }

  console.log(
    "[inbox/export] requested sources=%d form_types=%d status=%s q_len=%d",
    sourceFilters.length,
    formTypeFilters.length,
    statusFilter ?? "-",
    q.length
  );

  let rows: Array<{
    id: string;
    source: string;
    formType: string;
    submitterName: string | null;
    submitterEmail: string | null;
    status: Status;
    priority: "normal" | "high";
    receivedAt: Date;
    payload: unknown;
  }>;
  try {
    const query = getDb()
      .select({
        id: submissions.id,
        source: submissions.source,
        formType: submissions.formType,
        submitterName: submissions.submitterName,
        submitterEmail: submissions.submitterEmail,
        status: submissions.status,
        priority: submissions.priority,
        receivedAt: submissions.receivedAt,
        payload: submissions.payload,
      })
      .from(submissions)
      .orderBy(desc(submissions.receivedAt))
      .limit(MAX_ROWS);
    rows = conditions.length > 0 ? await query.where(and(...conditions)) : await query;
  } catch (err) {
    const code = err instanceof Error ? err.name : "UnknownError";
    console.error("[inbox/export] query failed err=%s", code);
    return new Response("Failed to load submissions.", { status: 500 });
  }

  const lines: string[] = [CSV_HEADER.join(",")];
  for (const row of rows) {
    lines.push(
      [
        csvField(row.id),
        csvField(row.source),
        csvField(row.formType),
        csvField(row.submitterName),
        csvField(row.submitterEmail),
        csvField(row.status),
        csvField(row.priority),
        csvField(row.receivedAt.toISOString()),
        csvField(JSON.stringify(row.payload ?? null)),
      ].join(",")
    );
  }
  const body = lines.join("\n") + "\n";

  const slugForName =
    sourceFilters.length === 1 ? sourceFilters[0] : sourceFilters.length > 1 ? "multi" : "all";
  const filename = `inbox-${slugForName}-${isoDate(new Date())}.csv`;

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
