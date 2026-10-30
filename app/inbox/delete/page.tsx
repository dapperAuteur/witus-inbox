import Link from "next/link";
import { count, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { replies, submissions } from "@/db/schema";
import { StatusBadge, type SubmissionStatus } from "@/components/StatusBadge";
import { BUTTON_DANGER, BUTTON_OUTLINE } from "@/components/ui/classes";
import { CONFIRM_VALUE, confirmPageIds, listReturnPath } from "@/lib/delete";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The confirm step for permanent delete. Opened from a submission's "Delete" control
 * (/inbox/delete?id=<id>) or from the list's "Delete selected" (the bulk form
 * submitted here as a GET, one `id` per ticked row). It names every item and how many
 * replies go with it; only its own form posts to POST /api/submissions/delete.
 * proxy.ts limits /inbox/* to the admin, as for the rest of the triage UI.
 */
export default async function DeleteConfirmPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const returnTo = listReturnPath(Array.isArray(sp.return) ? sp.return[0] : sp.return);
  const ids = confirmPageIds(sp.id);

  if (!ids) {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold tracking-tight">Nothing to delete</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          No submissions were selected. Tick one or more rows in the list, then choose Delete selected.
        </p>
        <Link href={returnTo} className={BUTTON_OUTLINE}>
          Back to the inbox
        </Link>
      </Shell>
    );
  }

  let items: Array<{
    id: string;
    source: string;
    formType: string;
    submitterName: string | null;
    submitterEmail: string | null;
    status: SubmissionStatus;
    receivedAt: Date;
  }> = [];
  const replyCounts = new Map<string, number>();
  try {
    const db = getDb();
    const [rows, counts] = await Promise.all([
      db
        .select({
          id: submissions.id,
          source: submissions.source,
          formType: submissions.formType,
          submitterName: submissions.submitterName,
          submitterEmail: submissions.submitterEmail,
          status: submissions.status,
          receivedAt: submissions.receivedAt,
        })
        .from(submissions)
        .where(inArray(submissions.id, ids)),
      db
        .select({ submissionId: replies.submissionId, n: count() })
        .from(replies)
        .where(inArray(replies.submissionId, ids))
        .groupBy(replies.submissionId),
    ]);
    items = rows;
    for (const c of counts) replyCounts.set(c.submissionId, c.n);
  } catch (err) {
    console.error("[inbox/delete] load failed ids=%d err=%s", ids.length, err instanceof Error ? err.name : "UnknownError");
    return (
      <Shell>
        <p className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/40 dark:text-red-200">
          Could not load these submissions. Check the server logs.
        </p>
        <Link href={returnTo} className={BUTTON_OUTLINE}>
          Back to the inbox
        </Link>
      </Shell>
    );
  }

  if (items.length === 0) {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold tracking-tight">Already gone</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          None of the selected submissions exist any more. They may have been deleted already.
        </p>
        <Link href={returnTo} className={BUTTON_OUTLINE}>
          Back to the inbox
        </Link>
      </Shell>
    );
  }

  const one = items.length === 1;
  const totalReplies = items.reduce((sum, i) => sum + (replyCounts.get(i.id) ?? 0), 0);
  const cancelHref = one ? `/inbox/${items[0].id}` : returnTo;
  const name = (i: (typeof items)[number]) => i.submitterName ?? i.submitterEmail ?? "Unknown sender";

  return (
    <Shell>
      <h1 className="text-2xl font-semibold tracking-tight">
        {one ? `Delete the submission from ${name(items[0])}?` : `Delete ${items.length} submissions?`}
      </h1>
      <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
        This permanently removes {one ? "it" : "them"}
        {totalReplies > 0 ? `, with ${totalReplies} ${totalReplies === 1 ? "reply" : "replies"} of history,` : ""} from the
        database. It cannot be undone. To get {one ? "it" : "them"} out of the way and keep the record, use Close or
        Archive instead.
      </p>

      <ul aria-label="Submissions to delete" className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
        {items.map((i) => {
          const n = replyCounts.get(i.id) ?? 0;
          return (
            <li key={i.id} className="space-y-1 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={i.status} />
                <span className="font-mono text-xs text-slate-500">{i.source}</span>
                <span className="text-xs text-slate-400">·</span>
                <span className="font-mono text-xs text-slate-500">{i.formType}</span>
              </div>
              <p className="break-words text-sm font-medium text-slate-900 dark:text-slate-100">{name(i)}</p>
              {i.submitterName && i.submitterEmail ? (
                <p className="break-all font-mono text-xs text-slate-500">{i.submitterEmail}</p>
              ) : null}
              <p className="text-xs text-slate-500">
                Received <time dateTime={i.receivedAt.toISOString()}>{i.receivedAt.toLocaleString()}</time>
                {n > 0 ? ` · ${n} ${n === 1 ? "reply" : "replies"}` : ""}
              </p>
            </li>
          );
        })}
      </ul>

      <form method="post" action="/api/submissions/delete" className="flex flex-wrap items-center gap-3">
        {items.map((i) => (
          <input key={i.id} type="hidden" name="id" value={i.id} />
        ))}
        <input type="hidden" name="confirm" value={CONFIRM_VALUE} />
        <input type="hidden" name="return" value={returnTo} />
        <button type="submit" className={BUTTON_DANGER}>
          {one ? "Delete permanently" : `Delete ${items.length} permanently`}
        </button>
        <Link href={cancelHref} className={BUTTON_OUTLINE}>
          Cancel
        </Link>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:py-10">
      {children}
    </main>
  );
}
