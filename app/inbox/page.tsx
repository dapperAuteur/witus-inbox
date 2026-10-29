import Link from "next/link";
import { and, asc, eq, isNotNull, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { submissions } from "@/db/schema";
import { listConfiguredSourceSlugs } from "@/lib/ingest-sources";
import { StatusBadge, type SubmissionStatus } from "@/components/StatusBadge";
import { SignOutButton, SignOutEverywhereButton } from "@/components/SignOutButton";
import { SelectAllCheckbox } from "@/components/SelectAllCheckbox";
import { Badge } from "@/components/ui/badge";
import { getWitusEndSessionUrl } from "@/lib/env";
import { archiveNotice } from "@/lib/archive";
import {
  KINDS,
  KIND_KEYS,
  MAX_Q_LENGTH,
  PAGE_SIZE,
  SORTS,
  SORT_LABELS,
  STATUSES,
  hasFilters,
  inboxHref,
  kindCondition,
  orderByFor,
  pageCount,
  parseInboxQuery,
  serializeInboxQuery,
  toggle,
  whereFor,
  type InboxQuery,
  type KindKey,
} from "@/lib/inbox-query";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const COUNT = sql<number>`count(*)::int`;

const STATUS_LABELS: Record<SubmissionStatus, string> = {
  new: "New",
  in_progress: "In progress",
  replied: "Replied",
  waiting: "Waiting",
  closed: "Closed",
};

/** `and()` that tolerates an undefined side (whereFor returns undefined for "no filter"). */
function both(a: SQL | undefined, b: SQL): SQL {
  return a ? (and(a, b) as SQL) : b;
}

interface Facets {
  kinds: Record<KindKey, number>;
  sources: Map<string, number>;
  high: number;
  fresh: number;
  archived: number;
}

export default async function InboxPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const query = parseInboxQuery(sp);
  const notice = archiveNotice(sp.done, sp.n);
  const db = getDb();

  // Facet options: the configured ecosystem allowlist plus whatever the DB has seen,
  // so a newly added app gets a chip before its first submission lands.
  let observedSources: string[] = [];
  let formTypeOptions: string[] = [];
  try {
    const [sourceRows, formTypeRows] = await Promise.all([
      db.selectDistinct({ source: submissions.source }).from(submissions).orderBy(asc(submissions.source)),
      db.selectDistinct({ formType: submissions.formType }).from(submissions).orderBy(asc(submissions.formType)),
    ]);
    observedSources = sourceRows.map((r) => r.source);
    formTypeOptions = formTypeRows.map((r) => r.formType);
  } catch (err) {
    console.error("[inbox] facet options failed err=%s", err instanceof Error ? err.name : "UnknownError");
  }
  const sourceOptions = Array.from(new Set([...listConfiguredSourceSlugs(), ...observedSources])).sort();
  const observedSourceSet = new Set(observedSources);

  // Only filter on values that exist; a stale bookmark with a removed app or form
  // type then shows everything else instead of an empty list.
  const validSources = new Set(sourceOptions);
  const validFormTypes = new Set(formTypeOptions);
  const view: InboxQuery = {
    ...query,
    sources: query.sources.filter((s) => validSources.has(s)),
    formTypes: query.formTypes.filter((t) => validFormTypes.has(t)),
  };

  let rows: Array<{
    id: string;
    source: string;
    formType: string;
    submitterName: string | null;
    submitterEmail: string | null;
    status: SubmissionStatus;
    priority: "normal" | "high";
    receivedAt: Date;
    archivedAt: Date | null;
  }> = [];
  let total = 0;
  let queryError: string | null = null;
  try {
    const where = whereFor(view);
    const [list, [{ n }]] = await Promise.all([
      db
        .select({
          id: submissions.id,
          source: submissions.source,
          formType: submissions.formType,
          submitterName: submissions.submitterName,
          submitterEmail: submissions.submitterEmail,
          status: submissions.status,
          priority: submissions.priority,
          receivedAt: submissions.receivedAt,
          archivedAt: submissions.archivedAt,
        })
        .from(submissions)
        .where(where)
        .orderBy(...orderByFor(view.sort))
        .limit(PAGE_SIZE)
        .offset((view.page - 1) * PAGE_SIZE),
      db.select({ n: COUNT }).from(submissions).where(where),
    ]);
    rows = list;
    total = n;
  } catch (err) {
    queryError = err instanceof Error ? err.name : "UnknownError";
    console.error("[inbox] list query failed err=%s", queryError);
  }

  // Chip counts. Each one leaves its own group out of the filter, so the number
  // beside a chip is what clicking it would show (see buildConditions).
  let facets: Facets | null = null;
  try {
    const [kindRow, sourceRows, high, fresh, archived] = await Promise.all([
      db
        .select(
          Object.fromEntries(
            KIND_KEYS.map((k) => [k, sql<number>`(count(*) filter (where ${kindCondition(k)}))::int`]),
          ) as Record<KindKey, SQL.Aliased<number> | SQL<number>>,
        )
        .from(submissions)
        .where(whereFor(view, "kind")),
      db
        .select({ source: submissions.source, n: COUNT })
        .from(submissions)
        .where(whereFor(view, "source"))
        .groupBy(submissions.source),
      db.select({ n: COUNT }).from(submissions).where(both(whereFor(view, "priority"), eq(submissions.priority, "high"))),
      db.select({ n: COUNT }).from(submissions).where(both(whereFor(view, "status"), eq(submissions.status, "new"))),
      db.select({ n: COUNT }).from(submissions).where(both(whereFor(view, "view"), isNotNull(submissions.archivedAt))),
    ]);
    facets = {
      kinds: kindRow[0] as Record<KindKey, number>,
      sources: new Map(sourceRows.map((r) => [r.source, r.n])),
      high: high[0].n,
      fresh: fresh[0].n,
      archived: archived[0].n,
    };
  } catch (err) {
    console.error("[inbox] chip counts failed err=%s", err instanceof Error ? err.name : "UnknownError");
  }

  const pages = pageCount(total);
  const firstRow = total === 0 ? 0 : (view.page - 1) * PAGE_SIZE + 1;
  const lastRow = Math.min(view.page * PAGE_SIZE, total);
  const currentHref = inboxHref(view, { page: view.page });
  const exportQs = serializeInboxQuery({ ...view, page: 1 }).toString();
  const exportHref = `/api/inbox/export${exportQs ? `?${exportQs}` : ""}`;
  const archivedView = view.view === "archived";
  const highOn = view.priorities.length === 1 && view.priorities[0] === "high";

  return (
    <main id="main" className="mx-auto w-full max-w-4xl px-4 py-6 sm:py-10">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{archivedView ? "Inbox: Archived" : "Inbox"}</h1>
        <div className="flex flex-col items-end gap-2 text-right">
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {total} {total === 1 ? "row" : "rows"}
            </span>
            {/* "Sign out" ends only this app's session (BAM, 2026-10-29, witus task 128 option (b)). */}
            <SignOutButton />
          </div>
          {/* Resolved on the server: null unless WITUS_OIDC_CLIENT_ID is set, in
              which case the second control also ends the shared WitUS session. */}
          <SignOutEverywhereButton endSessionUrl={getWitusEndSessionUrl()} />
        </div>
      </header>

      {notice ? (
        <p role="status" className="mb-4 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100">
          {notice}
        </p>
      ) : null}

      <nav aria-label="Quick filters" className="mb-4 space-y-3">
        <ChipGroup label="Show">
          <Chip
            href={inboxHref(view, { view: archivedView ? "active" : "archived" })}
            on={archivedView}
            label="Archived"
            count={facets?.archived}
          />
          <Chip
            href={inboxHref(view, { priorities: highOn ? [] : ["high"] })}
            on={highOn}
            label="High priority"
            count={facets?.high}
          />
          <Chip
            href={inboxHref(view, { status: view.status === "new" ? null : "new" })}
            on={view.status === "new"}
            label="Unread or new"
            count={facets?.fresh}
          />
        </ChipGroup>
        <ChipGroup label="Kind">
          {KIND_KEYS.map((k) => (
            <Chip
              key={k}
              href={inboxHref(view, { kinds: toggle(view.kinds, k) })}
              on={view.kinds.includes(k)}
              label={KINDS[k].label}
              count={facets?.kinds[k]}
            />
          ))}
        </ChipGroup>
        <ChipGroup label="Source">
          {sourceOptions.length === 0 ? (
            <span className="text-xs text-slate-400">No sources configured yet.</span>
          ) : (
            sourceOptions.map((s) => (
              <Chip
                key={s}
                href={inboxHref(view, { sources: toggle(view.sources, s) })}
                on={view.sources.includes(s)}
                label={s}
                mono
                quiet={!observedSourceSet.has(s)}
                count={facets ? (facets.sources.get(s) ?? 0) : undefined}
              />
            ))
          )}
        </ChipGroup>
        <p className="text-[11px] text-slate-400">
          Kinds are matched by form type name. Chips in different rows combine (Bugs and one app shows that
          app&apos;s bugs); counts show what each chip would add. Dashed apps have no submissions yet.
          {hasFilters(view) ? (
            <>
              {" "}
              <Link href={inboxHref({ ...view, kinds: [], sources: [], formTypes: [], priorities: [], status: null, q: "", from: null, to: null })} className="underline hover:text-slate-600">
                Clear filters
              </Link>
            </>
          ) : null}
        </p>
      </nav>

      <form method="get" className="mb-6 space-y-4 rounded-md border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        {/* The chips above own these; carry them so Apply does not drop them. */}
        {archivedView ? <input type="hidden" name="view" value="archived" /> : null}
        {view.kinds.map((k) => <input key={`k-${k}`} type="hidden" name="kind" value={k} />)}
        {view.sources.map((s) => <input key={`s-${s}`} type="hidden" name="source" value={s} />)}
        {view.priorities.map((p) => <input key={`p-${p}`} type="hidden" name="priority" value={p} />)}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Search">
            <input
              type="search"
              name="q"
              defaultValue={view.q}
              maxLength={MAX_Q_LENGTH}
              placeholder="Name, email, form type, or message text"
              className={INPUT}
            />
          </Field>
          <Field label="Status">
            <select name="status" defaultValue={view.status ?? ""} className={INPUT}>
              <option value="">All</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          </Field>
          <Field label="Received from (UTC)">
            <input type="date" name="from" defaultValue={view.from ?? ""} className={INPUT} />
          </Field>
          <Field label="Received to (UTC, inclusive)">
            <input type="date" name="to" defaultValue={view.to ?? ""} className={INPUT} />
          </Field>
          <Field label="Sort">
            <select name="sort" defaultValue={view.sort} className={INPUT}>
              {SORTS.map((s) => (
                <option key={s} value={s}>{SORT_LABELS[s]}</option>
              ))}
            </select>
          </Field>
        </div>

        <details open={view.formTypes.length > 0}>
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-slate-500">
            Exact form types{view.formTypes.length > 0 ? ` (${view.formTypes.length} selected)` : ""}
          </summary>
          <div className="mt-2 flex flex-wrap gap-2">
            {formTypeOptions.length === 0 ? (
              <p className="text-xs text-slate-400">No form types yet. They appear after the first submission of each type.</p>
            ) : (
              formTypeOptions.map((t) => (
                <label key={t} className="cursor-pointer">
                  <input type="checkbox" name="form_type" value={t} defaultChecked={view.formTypes.includes(t)} className="peer sr-only" />
                  <span className={PILL}>{t}</span>
                </label>
              ))
            )}
          </div>
        </details>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Link href={archivedView ? "/inbox?view=archived" : "/inbox"} className={BUTTON_GHOST}>
            Reset
          </Link>
          <a href={exportHref} className={BUTTON_OUTLINE}>
            Export CSV
          </a>
          <button type="submit" className={BUTTON_PRIMARY}>
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
          {view.page > pages ? (
            <>
              This page is past the end of the list.{" "}
              <Link href={inboxHref(view, { page: pages })} className="underline">
                Go to the last page
              </Link>
              .
            </>
          ) : archivedView ? (
            "Nothing archived matches the current filter."
          ) : (
            "No submissions match the current filter."
          )}
        </p>
      ) : (
        <form id="bulk" method="post" action="/api/submissions/archive">
          <input type="hidden" name="return" value={currentHref} />
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <SelectAllCheckbox formId="bulk" />
            <button type="submit" name="action" value={archivedView ? "unarchive" : "archive"} className={BUTTON_OUTLINE}>
              {archivedView ? "Unarchive selected" : "Archive selected"}
            </button>
          </div>
          <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
            {rows.map((row) => {
              const who = row.submitterName ?? row.submitterEmail ?? "Unknown sender";
              return (
                <li key={row.id} className="flex items-stretch">
                  <label className="flex min-w-11 cursor-pointer items-center justify-center pl-3">
                    <input
                      type="checkbox"
                      name="id"
                      value={row.id}
                      aria-label={`Select: ${who}, ${row.formType}`}
                      className="size-4 rounded border-slate-300 accent-sky-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
                    />
                  </label>
                  <Link
                    href={`/inbox/${row.id}`}
                    className="flex min-w-0 flex-1 flex-col gap-2 p-4 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-500 motion-reduce:transition-none dark:hover:bg-slate-800"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={row.status} />
                      {row.priority === "high" ? <Badge tone="red">High</Badge> : null}
                      {row.archivedAt ? <Badge tone="muted">Archived</Badge> : null}
                      <span className="font-mono text-xs text-slate-500">{row.source}</span>
                      <span className="text-xs text-slate-400">·</span>
                      <span className="font-mono text-xs text-slate-500">{row.formType}</span>
                    </div>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm text-slate-900 dark:text-slate-100">{who}</span>
                      <time dateTime={row.receivedAt.toISOString()} className="text-xs text-slate-500">
                        {row.receivedAt.toLocaleString()}
                      </time>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </form>
      )}

      {total > 0 ? (
        <nav aria-label="Pages" className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600 dark:text-slate-300">
          <span>
            {firstRow} to {lastRow} of {total} · page {Math.min(view.page, pages)} of {pages}
          </span>
          <span className="flex gap-2">
            {view.page > 1 ? (
              <Link href={inboxHref(view, { page: Math.min(view.page - 1, pages) })} rel="prev" className={BUTTON_OUTLINE}>
                Previous
              </Link>
            ) : null}
            {view.page < pages ? (
              <Link href={inboxHref(view, { page: view.page + 1 })} rel="next" className={BUTTON_OUTLINE}>
                Next
              </Link>
            ) : null}
          </span>
        </nav>
      ) : null}
    </main>
  );
}

const INPUT =
  "block w-full min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50";
const PILL =
  "inline-flex min-h-9 items-center rounded-full border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs text-slate-700 transition-colors hover:bg-slate-50 peer-checked:border-sky-600 peer-checked:bg-sky-600 peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-sky-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800";
const BUTTON_GHOST =
  "inline-flex min-h-11 items-center justify-center rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:text-slate-300 dark:hover:bg-slate-800";
const BUTTON_OUTLINE =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800";
const BUTTON_PRIMARY =
  "inline-flex min-h-11 items-center justify-center rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1">
      <span className="block text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function ChipGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-14 shrink-0 text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </div>
  );
}

/**
 * One quick filter. A link, not a checkbox: one click changes the view and the URL.
 * `aria-current` marks the chips that are on, and the check mark says it without
 * colour.
 */
function Chip({
  href,
  on,
  label,
  count,
  mono = false,
  quiet = false,
}: {
  href: string;
  on: boolean;
  label: string;
  count?: number;
  mono?: boolean;
  quiet?: boolean;
}) {
  const tone = on
    ? "border-sky-600 bg-sky-600 text-white hover:bg-sky-700"
    : quiet
      ? "border-dashed border-slate-300 bg-white text-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500 dark:hover:bg-slate-800"
      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800";
  return (
    <Link
      href={href}
      aria-current={on ? "true" : undefined}
      className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 motion-reduce:transition-none ${mono ? "font-mono" : ""} ${tone}`}
    >
      {on ? <span aria-hidden="true">✓</span> : null}
      {label}
      {count !== undefined ? (
        <span className={`tabular-nums ${on ? "text-sky-100" : "text-slate-400"}`}>
          <span className="sr-only">, </span>
          {count}
        </span>
      ) : null}
    </Link>
  );
}
