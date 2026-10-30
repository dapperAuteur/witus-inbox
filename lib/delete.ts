// lib/delete.ts
// Request parsing for permanent delete. Delete is the one triage action that cannot
// be undone, so it never runs from a single click:
//   1. a "Delete" control (detail page) or "Delete selected" (list) opens the confirm
//      page GET /inbox/delete?id=...&return=..., which names every item;
//   2. that page's form posts to POST /api/submissions/delete with `confirm=delete`.
// A post without `confirm=delete` is refused, so the bulk list form (which posts to
// the archive route) can never delete by accident.
// Pure (no env, no db, no next/*) so lib/delete.test.ts can pin it.

import { cleanIds, safeReturnPath } from "./archive";

export const CONFIRM_VALUE = "delete";

export interface DeleteRequest {
  ids: string[];
  /** Always a list view: the detail page of a deleted item would be a 404. */
  returnTo: string;
}

/**
 * Where to go after a delete. Only the /inbox list (with its query string) is
 * allowed; a detail page path falls back to the plain list.
 */
export function listReturnPath(value: unknown): string {
  const safe = safeReturnPath(value);
  const url = new URL(safe, "https://inbox.invalid");
  if (url.pathname !== "/inbox") return "/inbox";
  url.searchParams.delete("done");
  url.searchParams.delete("n");
  return `${url.pathname}${url.search}`;
}

/** The confirm page's form post: `id` (repeatable), `confirm=delete`, `return`. */
export function parseDeleteForm(form: FormData): DeleteRequest | null {
  if (form.get("confirm") !== CONFIRM_VALUE) return null;
  const ids = cleanIds(form.getAll("id"));
  if (!ids) return null;
  return { ids, returnTo: listReturnPath(form.get("return")) };
}

/** A JSON body: `{ ids: string[], confirm: "delete" }`. */
export function parseDeleteJson(body: unknown): DeleteRequest | null {
  if (!body || typeof body !== "object") return null;
  const { ids, confirm } = body as { ids?: unknown; confirm?: unknown };
  if (confirm !== CONFIRM_VALUE || !Array.isArray(ids)) return null;
  const clean = cleanIds(ids);
  if (!clean) return null;
  return { ids: clean, returnTo: "/inbox" };
}

/**
 * The ids the confirm page was opened with (`?id=` repeatable), or null when there
 * are none or any is malformed. Same limits as the archive route.
 */
export function confirmPageIds(raw: string | string[] | undefined): string[] | null {
  if (raw === undefined) return null;
  return cleanIds(Array.isArray(raw) ? raw : [raw]);
}

/**
 * Second lock behind proxy.ts: delete is permanent, so the route checks that the
 * session's email is the admin's, not only that a session exists.
 */
export function isAdminEmail(sessionEmail: unknown, adminEmail: string): boolean {
  if (typeof sessionEmail !== "string" || !adminEmail) return false;
  return sessionEmail.trim().toLowerCase() === adminEmail.trim().toLowerCase();
}
