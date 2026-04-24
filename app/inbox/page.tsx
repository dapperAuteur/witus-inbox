import Link from "next/link";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { submissions } from "@/db/schema";
import { StatusBadge, type SubmissionStatus } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

const VALID_STATUSES: SubmissionStatus[] = ["new", "in_progress", "replied", "waiting", "closed"];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function takeOne(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function InboxPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const sourceFilter = takeOne(sp.source)?.trim() || undefined;
  const statusRaw = takeOne(sp.status);
  const statusFilter = VALID_STATUSES.find((s) => s === statusRaw);

  const conditions: SQL[] = [];
  if (sourceFilter) conditions.push(eq(submissions.source, sourceFilter));
  if (statusFilter) conditions.push(eq(submissions.status, statusFilter));

  let rows: Array<{
    id: string;
    source: string;
    formType: string;
    submitterName: string | null;
    submitterEmail: string | null;
    status: SubmissionStatus;
    priority: "normal" | "high";
    receivedAt: Date;
  }> = [];
  let queryError: string | null = null;

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
      })
      .from(submissions)
      .orderBy(desc(submissions.receivedAt))
      .limit(100);
    rows = conditions.length > 0 ? await query.where(and(...conditions)) : await query;
  } catch (err) {
    queryError = err instanceof Error ? err.name : "UnknownError";
    console.error("[inbox] list query failed err=%s", queryError);
  }

  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-10">
      <header className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {rows.length} {rows.length === 1 ? "row" : "rows"}
        </span>
      </header>

      <form method="get" className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_12rem_auto]">
        <label className="space-y-1">
          <span className="block text-xs font-medium uppercase tracking-wide text-slate-500">Source</span>
          <input
            type="text"
            name="source"
            defaultValue={sourceFilter ?? ""}
            placeholder="e.g. witus-online"
            className="block w-full min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
          />
        </label>
        <label className="space-y-1">
          <span className="block text-xs font-medium uppercase tracking-wide text-slate-500">Status</span>
          <select
            name="status"
            defaultValue={statusFilter ?? ""}
            className="block w-full min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
          >
            <option value="">All</option>
            {VALID_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 sm:w-auto"
          >
            Filter
          </button>
        </div>
      </form>

      {queryError ? (
        <p className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/40 dark:text-red-200">
          Could not load submissions. Check the server logs.
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
          No submissions match the current filter.
        </p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                href={`/inbox/${row.id}`}
                className="flex flex-col gap-2 p-4 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-sky-500 motion-reduce:transition-none dark:hover:bg-slate-800"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={row.status} />
                  {row.priority === "high" ? <Badge tone="red">High</Badge> : null}
                  <span className="font-mono text-xs text-slate-500">{row.source}</span>
                  <span className="text-xs text-slate-400">·</span>
                  <span className="font-mono text-xs text-slate-500">{row.formType}</span>
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm text-slate-900 dark:text-slate-100">
                    {row.submitterName ?? row.submitterEmail ?? "Unknown sender"}
                  </span>
                  <time dateTime={row.receivedAt.toISOString()} className="text-xs text-slate-500">
                    {row.receivedAt.toLocaleString()}
                  </time>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
