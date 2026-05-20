import Link from "next/link";
import { and, asc, desc, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { submissions } from "@/db/schema";
import { StatusBadge, type SubmissionStatus } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

const VALID_STATUSES: SubmissionStatus[] = ["new", "in_progress", "replied", "waiting", "closed"];
const MAX_Q_LENGTH = 100;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function takeOne(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function takeMany(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  const arr = Array.isArray(value) ? value : [value];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of arr) {
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

export default async function InboxPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const sourceFilters = takeMany(sp.source);
  const formTypeFilters = takeMany(sp.form_type);
  const statusRaw = takeOne(sp.status);
  const statusFilter = VALID_STATUSES.find((s) => s === statusRaw);
  const q = takeOne(sp.q)?.trim().slice(0, MAX_Q_LENGTH) || "";

  const db = getDb();

  let sourceOptions: string[] = [];
  let formTypeOptions: string[] = [];
  try {
    const [sourceRows, formTypeRows] = await Promise.all([
      db
        .selectDistinct({ source: submissions.source })
        .from(submissions)
        .orderBy(asc(submissions.source)),
      db
        .selectDistinct({ formType: submissions.formType })
        .from(submissions)
        .orderBy(asc(submissions.formType)),
    ]);
    sourceOptions = sourceRows.map((r) => r.source);
    formTypeOptions = formTypeRows.map((r) => r.formType);
  } catch (err) {
    const code = err instanceof Error ? err.name : "UnknownError";
    console.error("[inbox] facet query failed err=%s", code);
  }

  const validSources = new Set(sourceOptions);
  const validFormTypes = new Set(formTypeOptions);
  const selectedSources = sourceFilters.filter((s) => validSources.has(s));
  const selectedFormTypes = formTypeFilters.filter((t) => validFormTypes.has(t));

  const conditions: SQL[] = [];
  if (selectedSources.length > 0) {
    conditions.push(inArray(submissions.source, selectedSources));
  }
  if (selectedFormTypes.length > 0) {
    conditions.push(inArray(submissions.formType, selectedFormTypes));
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

  const exportQuery = new URLSearchParams();
  for (const s of selectedSources) exportQuery.append("source", s);
  for (const t of selectedFormTypes) exportQuery.append("form_type", t);
  if (statusFilter) exportQuery.set("status", statusFilter);
  if (q) exportQuery.set("q", q);
  const exportHref = `/api/inbox/export${exportQuery.toString() ? `?${exportQuery.toString()}` : ""}`;

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
    const query = db
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
    <main id="main" className="mx-auto w-full max-w-4xl px-4 py-6 sm:py-10">
      <header className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {rows.length} {rows.length === 1 ? "row" : "rows"}
        </span>
      </header>

      <form method="get" className="mb-6 space-y-4 rounded-md border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <PillGroup
          legend="Source"
          name="source"
          options={sourceOptions}
          selected={selectedSources}
          emptyHint="No sources yet."
        />
        <PillGroup
          legend="Form type"
          name="form_type"
          options={formTypeOptions}
          selected={selectedFormTypes}
          emptyHint="No form types yet."
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_12rem]">
          <label className="space-y-1">
            <span className="block text-xs font-medium uppercase tracking-wide text-slate-500">Search (name / email)</span>
            <input
              type="search"
              name="q"
              defaultValue={q}
              maxLength={MAX_Q_LENGTH}
              placeholder="e.g. acme.com or Jane"
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
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Link
            href="/inbox"
            className="inline-flex min-h-11 items-center justify-center rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Reset
          </Link>
          <a
            href={exportHref}
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            Export CSV
          </a>
          <button
            type="submit"
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
          >
            Apply filters
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
                className="flex flex-col gap-2 p-4 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-500 motion-reduce:transition-none dark:hover:bg-slate-800"
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

function PillGroup({
  legend,
  name,
  options,
  selected,
  emptyHint,
}: {
  legend: string;
  name: string;
  options: string[];
  selected: string[];
  emptyHint: string;
}) {
  const selectedSet = new Set(selected);
  return (
    <fieldset>
      <legend className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">
        {legend}
        {selected.length > 0 ? (
          <span className="ml-2 normal-case tracking-normal text-slate-400">({selected.length} selected)</span>
        ) : null}
      </legend>
      {options.length === 0 ? (
        <p className="text-xs text-slate-400">{emptyHint}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((opt) => {
            const isChecked = selectedSet.has(opt);
            return (
              <label key={opt} className="cursor-pointer">
                <input
                  type="checkbox"
                  name={name}
                  value={opt}
                  defaultChecked={isChecked}
                  className="peer sr-only"
                />
                <span className="inline-flex min-h-9 items-center rounded-full border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs text-slate-700 transition-colors hover:bg-slate-50 peer-checked:border-sky-600 peer-checked:bg-sky-600 peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-sky-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:peer-checked:bg-sky-600 dark:peer-checked:text-white">
                  {opt}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}
