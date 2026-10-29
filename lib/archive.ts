// lib/archive.ts
// Request parsing for POST /api/submissions/archive (archive or unarchive one or
// many submissions). Two callers:
//   - the /inbox list's bulk form and the detail page's button, as a plain HTML
//     form post (works without JavaScript), answered with a 303 back to the page;
//   - fetch() callers with JSON, answered with JSON.
// Pure (no env, no db, no next/*) so lib/archive.test.ts can pin it.

export const MAX_ARCHIVE_IDS = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ArchiveRequest {
  ids: string[];
  archived: boolean;
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

function cleanIds(values: unknown[]): string[] | null {
  const ids: string[] = [];
  for (const v of values) {
    if (typeof v !== "string" || !UUID.test(v)) return null;
    const id = v.toLowerCase();
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length === 0 || ids.length > MAX_ARCHIVE_IDS) return null;
  return ids;
}

/** A form post: `id` (repeatable), `action=archive|unarchive`, `return`. */
export function parseArchiveForm(form: FormData): ArchiveRequest | null {
  const action = form.get("action");
  if (action !== "archive" && action !== "unarchive") return null;
  const ids = cleanIds(form.getAll("id"));
  if (!ids) return null;
  return { ids, archived: action === "archive", returnTo: safeReturnPath(form.get("return")) };
}

/** A JSON body: `{ ids: string[], archived: boolean }`. */
export function parseArchiveJson(body: unknown): ArchiveRequest | null {
  if (!body || typeof body !== "object") return null;
  const { ids, archived } = body as { ids?: unknown; archived?: unknown };
  if (!Array.isArray(ids) || typeof archived !== "boolean") return null;
  const clean = cleanIds(ids);
  if (!clean) return null;
  return { ids: clean, archived, returnTo: "/inbox" };
}

/**
 * The page a form post returns to, with a one-line notice ("Archived 3.") the list
 * shows once. `done` and `n` are not part of the saved view (lib/inbox-query.ts
 * ignores them), so they drop off the next link the operator clicks.
 */
export function returnUrlWithNotice(returnTo: string, archived: boolean, count: number): string {
  const url = new URL(returnTo, "https://inbox.invalid");
  url.searchParams.set("done", archived ? "archived" : "unarchived");
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
