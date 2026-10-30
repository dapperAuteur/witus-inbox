// lib/archive.ts
// Request parsing for POST /api/submissions/archive: the reversible triage actions
// on one or many submissions.
//   archive / unarchive   set or clear `archived_at` (the Archived view)
//   close / reopen        set `status` to closed, or a closed one back to in_progress
// Two callers:
//   - the /inbox list's bulk form and the detail page's action buttons, as a plain
//     HTML form post (works without JavaScript), answered with a 303 back to the page;
//   - fetch() callers with JSON, answered with JSON.
// Permanent delete is a separate route with its own confirm step (lib/delete.ts).
// Pure (no env, no db, no next/*) so lib/archive.test.ts can pin it.

export const MAX_ARCHIVE_IDS = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const TRIAGE_ACTIONS = ["archive", "unarchive", "close", "reopen"] as const;
export type TriageAction = (typeof TRIAGE_ACTIONS)[number];

function isTriageAction(value: unknown): value is TriageAction {
  return typeof value === "string" && (TRIAGE_ACTIONS as readonly string[]).includes(value);
}

export interface ArchiveRequest {
  ids: string[];
  action: TriageAction;
  /** Where a form post goes back to. Always a same-site /inbox path. */
  returnTo: string;
}

/**
 * Only a relative path under /inbox may be a return target, so the form cannot be
 * used to bounce the browser to another site. Anything else becomes "/inbox".
 */
export function safeReturnPath(value: unknown): string {
  if (typeof value !== "string") return "/inbox";
  if (!value.startsWith("/inbox")) return "/inbox";
  // "/inbox" followed by "/", "?", "#" or nothing; never "/inboxevil" or "//host".
  const next = value.charAt("/inbox".length);
  if (next !== "" && next !== "/" && next !== "?" && next !== "#") return "/inbox";
  if (value.includes("\\") || value.includes("//")) return "/inbox";
  return value.slice(0, 2000);
}

export function cleanIds(values: unknown[]): string[] | null {
  const ids: string[] = [];
  for (const v of values) {
    if (typeof v !== "string" || !UUID.test(v)) return null;
    const id = v.toLowerCase();
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length === 0 || ids.length > MAX_ARCHIVE_IDS) return null;
  return ids;
}

/** A form post: `id` (repeatable), `action=archive|unarchive|close|reopen`, `return`. */
export function parseArchiveForm(form: FormData): ArchiveRequest | null {
  const action = form.get("action");
  if (!isTriageAction(action)) return null;
  const ids = cleanIds(form.getAll("id"));
  if (!ids) return null;
  return { ids, action, returnTo: safeReturnPath(form.get("return")) };
}

/**
 * A JSON body: `{ ids: string[], action: "archive" | "unarchive" | "close" | "reopen" }`,
 * or the original `{ ids: string[], archived: boolean }`, which still works.
 */
export function parseArchiveJson(body: unknown): ArchiveRequest | null {
  if (!body || typeof body !== "object") return null;
  const { ids, archived, action } = body as { ids?: unknown; archived?: unknown; action?: unknown };
  if (!Array.isArray(ids)) return null;
  let resolved: TriageAction;
  if (action !== undefined) {
    if (!isTriageAction(action)) return null;
    resolved = action;
  } else if (typeof archived === "boolean") {
    resolved = archived ? "archive" : "unarchive";
  } else {
    return null;
  }
  const clean = cleanIds(ids);
  if (!clean) return null;
  return { ids: clean, action: resolved, returnTo: "/inbox" };
}

/** What the `?done=` notice calls each action once it has happened. */
export type DoneKey = "archived" | "unarchived" | "closed" | "reopened" | "deleted";

const DONE_FOR: Record<TriageAction, DoneKey> = {
  archive: "archived",
  unarchive: "unarchived",
  close: "closed",
  reopen: "reopened",
};

export function doneKeyFor(action: TriageAction): DoneKey {
  return DONE_FOR[action];
}

/**
 * The page a form post returns to, with a one-line notice ("Archived 3.") the list
 * shows once. `done` and `n` are not part of the saved view (lib/inbox-query.ts
 * ignores them), so they drop off the next link the operator clicks.
 */
export function returnUrlWithNotice(returnTo: string, done: DoneKey, count: number): string {
  const url = new URL(returnTo, "https://inbox.invalid");
  url.searchParams.set("done", done);
  url.searchParams.set("n", String(count));
  return `${url.pathname}${url.search}`;
}

/** The notice text for `?done=&n=`, or null when there is none. */
export function archiveNotice(done: unknown, n: unknown): string | null {
  const count = Number.parseInt(typeof n === "string" ? n : "", 10);
  if (!Number.isFinite(count) || count < 0) return null;
  const what = count === 1 ? "1 submission" : `${count} submissions`;
  if (done === "archived") return `Archived ${what}. They are under Archived.`;
  if (done === "unarchived") return `Moved ${what} back to the inbox.`;
  if (done === "closed") return `Closed ${what}. Closed items are hidden from the list; the Closed chip shows them.`;
  if (done === "reopened") return `Reopened ${what}. They are back in the list as In progress.`;
  if (done === "deleted") return `Deleted ${what} permanently.`;
  return null;
}

/** The one-line notice on a submission's own page after an action on it. */
export function detailNotice(done: unknown): string | null {
  if (done === "archived") return "Archived. It stays here, with its history, under Archived.";
  if (done === "unarchived") return "Back in the inbox.";
  if (done === "closed") return "Closed. It is hidden from the inbox list; the Closed chip shows it, and a reply from the sender reopens it.";
  if (done === "reopened") return "Reopened as In progress.";
  return null;
}

/**
 * True when a browser form post came from this site. A cross-site form post would
 * not carry the SameSite=Lax session cookie anyway; this is the second lock. A
 * request with no Origin header (old browsers, curl) is left to the session check.
 */
export function isSameOrigin(originHeader: string | null, host: string | null): boolean {
  if (!originHeader) return true;
  if (!host) return false;
  try {
    return new URL(originHeader).host === host;
  } catch {
    return false;
  }
}
