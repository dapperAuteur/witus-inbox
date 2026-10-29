import { type NextRequest } from "next/server";
import { getDb } from "@/db";
import { submissions } from "@/db/schema";
import { orderByFor, parseInboxQuery, whereFor, type Priority, type Status } from "@/lib/inbox-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ROWS = 10000;

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
  // Appended last (2026-10-29) so existing column positions do not move.
  "archived_at",
];

function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "string" ? value : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

function isoDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest): Promise<Response> {
  // The same parser and WHERE as the /inbox page, so the CSV is exactly the
  // current view (archived or active, chips, search, dates, sort), every page.
  const query = parseInboxQuery(new URL(request.url).searchParams);
  const sourceFilters = query.sources;

  console.log(
    "[inbox/export] requested view=%s kinds=%d sources=%d form_types=%d priorities=%d status=%s q_len=%d from=%s to=%s sort=%s",
    query.view,
    query.kinds.length,
    query.sources.length,
    query.formTypes.length,
    query.priorities.length,
    query.status ?? "-",
    query.q.length,
    query.from ?? "-",
    query.to ?? "-",
    query.sort,
  );

  let rows: Array<{
    id: string;
    source: string;
    formType: string;
    submitterName: string | null;
    submitterEmail: string | null;
    status: Status;
    priority: Priority;
    receivedAt: Date;
    payload: unknown;
    archivedAt: Date | null;
  }>;
  try {
    rows = await getDb()
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
        archivedAt: submissions.archivedAt,
      })
      .from(submissions)
      .where(whereFor(query))
      .orderBy(...orderByFor(query.sort))
      .limit(MAX_ROWS);
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
        csvField(row.archivedAt ? row.archivedAt.toISOString() : null),
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
