// lib/inbox-query.ts
// The /inbox list's view state: parse it from the URL, write it back to the URL,
// and turn it into SQL. One module so the list page, its chip links, its pager and
// the CSV export all agree on what a given URL means, and so a view can be
// bookmarked or shared as a plain link.
//
// URL parameters (all optional; defaults are omitted when writing a URL):
//   view=archived          the Archived view (default: active, i.e. not archived)
//   kind=bug|feature|question|waitlist   repeatable; natural "kind" chips (OR)
//   source=<slug>          repeatable; one chip per ecosystem app (OR)
//   form_type=<type>       repeatable; exact form types (OR)
//   priority=normal|high   repeatable
//   status=<status>|any    one of the submission statuses ("Unread or new" = status=new,
//                          "Closed" = status=closed), or "any" for every status. With no
//                          status, closed submissions are hidden (the default list is open work).
//   q=<text>               search: name, email, form type, and the payload text
//   from=YYYY-MM-DD, to=YYYY-MM-DD   received date range, inclusive, in UTC
//   sort=newest|oldest|priority|source|kind
//   page=<n>               1-based
// Groups combine with AND (Bugs + invest-witus = bugs from invest-witus); values
// inside one group combine with OR.
//
// No env, no next/*, no server-only: lib/inbox-query.test.ts pins it.

import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { submissions } from "@/db/schema";

export const PAGE_SIZE = 50;
export const MAX_Q_LENGTH = 100;
const MAX_PAGE = 10_000;
const MAX_FORM_TYPE_LENGTH = 100;

export const STATUSES = ["new", "in_progress", "replied", "waiting", "closed"] as const;
export type Status = (typeof STATUSES)[number];
/** The status filter: one status, or "any" for every status including closed. */
export type StatusFilter = Status | "any";
export const PRIORITIES = ["normal", "high"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const SORTS = ["newest", "oldest", "priority", "source", "kind"] as const;
export type SortKey = (typeof SORTS)[number];
export const SORT_LABELS: Record<SortKey, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  priority: "High priority first",
  source: "App (A to Z)",
  kind: "Form type (A to Z)",
};
export type View = "active" | "archived";

/**
 * The natural "kind" chips. `form_type` is free text chosen by each sending app, so
 * a kind is a case-insensitive match on the form type's name. The patterns were
 * written against the form types actually in the Inbox on 2026-10-29
 * (learn-witus-problem-report, invest-witus-feature-request, contact, waitlist,
 * waitlist-signup, learn-course-notify, learn-course-interest:expert,
 * bvc-pilot-signup, ...). A form type that matches none (hire, partner,
 * client-intake) is still reachable through the exact Form type filter.
 *
 * Patterns are POSIX regular expressions run by Postgres `~*`, and the same strings
 * run in JS (kindsOf) for the tests. Keep them to plain alternation.
 */
export const KINDS = {
  bug: { label: "Bugs", pattern: "bug|problem|error|issue|crash" },
  feature: { label: "Feature requests", pattern: "feature|idea|suggest" },
  question: { label: "Questions", pattern: "question|contact|support|help|inquir" },
  waitlist: { label: "Waitlist signups", pattern: "waitlist|signup|sign-up|notify|interest|pilot" },
} as const;
export type KindKey = keyof typeof KINDS;
export const KIND_KEYS = Object.keys(KINDS) as KindKey[];

/** The kinds a form type falls under (it can be more than one, or none). */
export function kindsOf(formType: string): KindKey[] {
  return KIND_KEYS.filter((k) => new RegExp(KINDS[k].pattern, "i").test(formType));
}

export interface InboxQuery {
  view: View;
  kinds: KindKey[];
  sources: string[];
  formTypes: string[];
  priorities: Priority[];
  /** null = every status except closed (the default list is open work). */
  status: StatusFilter | null;
  q: string;
  from: string | null;
  to: string | null;
  sort: SortKey;
  page: number;
}

export const DEFAULT_QUERY: InboxQuery = {
  view: "active",
  kinds: [],
  sources: [],
  formTypes: [],
  priorities: [],
  status: null,
  q: "",
  from: null,
  to: null,
  sort: "newest",
  page: 1,
};

type RawParams = URLSearchParams | Record<string, string | string[] | undefined>;

function getAll(params: RawParams, key: string): string[] {
  if (params instanceof URLSearchParams) return params.getAll(key);
  const v = params[key];
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function getOne(params: RawParams, key: string): string | undefined {
  return getAll(params, key)[0];
}

function dedupe(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    const t = v.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

const SLUG = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date in YYYY-MM-DD form, or null. */
export function parseDate(value: string | undefined): string | null {
  if (!value || !DATE.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return null;
  return value;
}

/** Read the view state from a URL. Anything malformed falls back to the default. */
export function parseInboxQuery(params: RawParams): InboxQuery {
  const pick = <T extends string>(allowed: readonly T[], values: string[]): T[] =>
    dedupe(values).filter((v): v is T => (allowed as readonly string[]).includes(v));

  let from = parseDate(getOne(params, "from"));
  let to = parseDate(getOne(params, "to"));
  if (from && to && from > to) [from, to] = [to, from];

  const pageRaw = Number.parseInt(getOne(params, "page") ?? "", 10);
  const statusRaw = getOne(params, "status");
  const sortRaw = getOne(params, "sort");

  return {
    view: getOne(params, "view") === "archived" ? "archived" : "active",
    kinds: pick(KIND_KEYS, getAll(params, "kind")),
    sources: dedupe(getAll(params, "source")).filter((s) => SLUG.test(s)),
    formTypes: dedupe(getAll(params, "form_type")).filter((t) => t.length <= MAX_FORM_TYPE_LENGTH),
    priorities: pick(PRIORITIES, getAll(params, "priority")),
    status: statusRaw === "any" ? "any" : (STATUSES.find((s) => s === statusRaw) ?? null),
    q: getOne(params, "q")?.trim().slice(0, MAX_Q_LENGTH) ?? "",
    from,
    to,
    sort: SORTS.find((s) => s === sortRaw) ?? "newest",
    page: Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.min(pageRaw, MAX_PAGE) : 1,
  };
}

/** Write the view state to URL parameters, leaving out every default. */
export function serializeInboxQuery(query: InboxQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (query.view === "archived") p.set("view", "archived");
  for (const k of query.kinds) p.append("kind", k);
  for (const s of query.sources) p.append("source", s);
  for (const t of query.formTypes) p.append("form_type", t);
  for (const pr of query.priorities) p.append("priority", pr);
  if (query.status) p.set("status", query.status);
  if (query.q) p.set("q", query.q);
  if (query.from) p.set("from", query.from);
  if (query.to) p.set("to", query.to);
  if (query.sort !== "newest") p.set("sort", query.sort);
  if (query.page > 1) p.set("page", String(query.page));
  return p;
}

/**
 * The /inbox link for the current view with `patch` applied. Any change other than
 * the page itself goes back to page 1, so a filter never lands on an empty page 7.
 */
export function inboxHref(query: InboxQuery, patch: Partial<InboxQuery> = {}, base = "/inbox"): string {
  const next: InboxQuery = { ...query, ...patch, page: patch.page ?? 1 };
  const qs = serializeInboxQuery(next).toString();
  return qs ? `${base}?${qs}` : base;
}

/** Add `value` if absent, remove it if present. */
export function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** True when anything other than view, sort and page narrows the list. */
export function hasFilters(query: InboxQuery): boolean {
  return (
    query.kinds.length > 0 ||
    query.sources.length > 0 ||
    query.formTypes.length > 0 ||
    query.priorities.length > 0 ||
    query.status !== null ||
    query.q !== "" ||
    query.from !== null ||
    query.to !== null
  );
}

function escapeLike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/[%_]/g, "\\$&");
}

/** SQL for "this row's form type falls under kind k". */
export function kindCondition(k: KindKey): SQL {
  return sql`${submissions.formType} ~* ${KINDS[k].pattern}`;
}

/** The filter groups a chip count can leave out (see facet counts on the page). */
export type FacetGroup = "view" | "kind" | "source" | "priority" | "status";

/**
 * The WHERE conditions for a view. `omit` drops one group, which is how each chip's
 * count is computed: the count beside "Bugs" is the rows that match every OTHER
 * active filter and are bugs, so it says what clicking the chip would show.
 */
export function buildConditions(query: InboxQuery, omit?: FacetGroup): SQL[] {
  const c: SQL[] = [];
  if (omit !== "view") {
    c.push(query.view === "archived" ? isNotNull(submissions.archivedAt) : isNull(submissions.archivedAt));
  }
  if (omit !== "kind" && query.kinds.length > 0) {
    const any = or(...query.kinds.map(kindCondition));
    if (any) c.push(any);
  }
  if (omit !== "source" && query.sources.length > 0) c.push(inArray(submissions.source, query.sources));
  if (query.formTypes.length > 0) c.push(inArray(submissions.formType, query.formTypes));
  if (omit !== "priority" && query.priorities.length > 0) {
    c.push(inArray(submissions.priority, query.priorities));
  }
  if (query.q) {
    const pattern = `%${escapeLike(query.q)}%`;
    const any = or(
      ilike(submissions.submitterName, pattern),
      ilike(submissions.submitterEmail, pattern),
      ilike(submissions.formType, pattern),
      sql`${submissions.payload}::text ilike ${pattern}`,
    );
    if (any) c.push(any);
  }
  if (query.from) c.push(gte(submissions.receivedAt, new Date(`${query.from}T00:00:00Z`)));
  if (query.to) {
    // Inclusive end date: everything before the start of the next UTC day.
    const end = new Date(`${query.to}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    c.push(lt(submissions.receivedAt, end));
  }
  // Last, so the parameter numbers of the groups above do not depend on it.
  if (omit !== "status") {
    // Closing a submission takes it out of the default list, as archiving does; the
    // Closed chip (status=closed) or "All, including closed" (status=any) shows it.
    if (query.status === null) c.push(ne(submissions.status, "closed"));
    else if (query.status !== "any") c.push(eq(submissions.status, query.status));
  }
  return c;
}

/** `and(...)` of the conditions, or undefined for "no filter". */
export function whereFor(query: InboxQuery, omit?: FacetGroup): SQL | undefined {
  const c = buildConditions(query, omit);
  return c.length > 0 ? and(...c) : undefined;
}

/** ORDER BY for a sort key. Every order ends on received_at then id so pages are stable. */
export function orderByFor(sort: SortKey): SQL[] {
  const newest = [desc(submissions.receivedAt), desc(submissions.id)];
  switch (sort) {
    case "oldest":
      return [asc(submissions.receivedAt), asc(submissions.id)];
    case "priority":
      return [sql`case when ${submissions.priority} = 'high' then 0 else 1 end`, ...newest];
    case "source":
      return [asc(submissions.source), ...newest];
    case "kind":
      return [asc(submissions.formType), ...newest];
    default:
      return newest;
  }
}

/** The page count for `total` rows (at least 1, so "page 1 of 1" on an empty list). */
export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}
