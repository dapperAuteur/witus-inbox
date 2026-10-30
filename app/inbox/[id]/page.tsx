import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { replies, submissions } from "@/db/schema";
import { PayloadRenderer } from "@/components/PayloadRenderer";
import { ReplyComposer } from "@/components/ReplyComposer";
import { StatusBadge, type SubmissionStatus } from "@/components/StatusBadge";
import { StatusControl } from "@/components/StatusControl";
import { Badge } from "@/components/ui/badge";
import { BUTTON_DANGER_OUTLINE, BUTTON_OUTLINE } from "@/components/ui/classes";
import { detailNotice } from "@/lib/archive";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SubmissionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const notice = detailNotice(sp.done);
  if (!UUID.test(id)) notFound();

  const db = getDb();

  let submission:
    | {
        id: string;
        source: string;
        formType: string;
        submitterEmail: string | null;
        submitterName: string | null;
        payload: unknown;
        status: SubmissionStatus;
        priority: "normal" | "high";
        receivedAt: Date;
        archivedAt: Date | null;
      }
    | undefined;

  try {
    const rows = await db
      .select({
        id: submissions.id,
        source: submissions.source,
        formType: submissions.formType,
        submitterEmail: submissions.submitterEmail,
        submitterName: submissions.submitterName,
        payload: submissions.payload,
        status: submissions.status,
        priority: submissions.priority,
        receivedAt: submissions.receivedAt,
        archivedAt: submissions.archivedAt,
      })
      .from(submissions)
      .where(eq(submissions.id, id))
      .limit(1);
    submission = rows[0];
  } catch (err) {
    const code = err instanceof Error ? err.name : "UnknownError";
    console.error("[inbox/detail] load failed id=%s err=%s", id, code);
    return (
      <main id="main" className="mx-auto w-full max-w-3xl px-4 py-10">
        <p className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/40 dark:text-red-200">
          Could not load this submission. Check the server logs.
        </p>
      </main>
    );
  }

  if (!submission) notFound();

  let history: Array<{ id: string; body: string; sentAt: Date; sentByEmail: string | null; direction: "outbound" | "inbound" }> = [];
  try {
    history = await db
      .select({
        id: replies.id,
        body: replies.body,
        sentAt: replies.sentAt,
        sentByEmail: replies.sentByEmail,
        direction: replies.direction,
      })
      .from(replies)
      .where(eq(replies.submissionId, id))
      .orderBy(asc(replies.sentAt));
  } catch (err) {
    const code = err instanceof Error ? err.name : "UnknownError";
    console.error("[inbox/detail] replies load failed id=%s err=%s", id, code);
    // Render the detail without history rather than failing the page.
  }

  return (
    <main id="main" className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:py-10">
      <nav className="text-sm">
        <Link
          href={submission.archivedAt ? "/inbox?view=archived" : "/inbox"}
          className="text-sky-600 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:text-sky-400"
        >
          ← Back to {submission.archivedAt ? "Archived" : "inbox"}
        </Link>
      </nav>

      {notice ? (
        <p role="status" className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100">
          {notice}
        </p>
      ) : null}

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={submission.status} />
          {submission.priority === "high" ? <Badge tone="red">High</Badge> : null}
          {submission.archivedAt ? <Badge tone="muted">Archived</Badge> : null}
          <span className="font-mono text-xs text-slate-500">{submission.source}</span>
          <span className="text-xs text-slate-400">·</span>
          <span className="font-mono text-xs text-slate-500">{submission.formType}</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {submission.submitterName ?? submission.submitterEmail ?? "Unknown sender"}
        </h1>
        {submission.submitterEmail ? (
          <p className="font-mono text-xs text-slate-500">{submission.submitterEmail}</p>
        ) : null}
        <time
          dateTime={submission.receivedAt.toISOString()}
          className="block text-xs text-slate-500"
        >
          Received {submission.receivedAt.toLocaleString()}
        </time>
      </header>

      {/* Close, Archive and Delete, at the top so they are found without scrolling.
          Close and Archive are plain form posts to app/api/submissions/archive (303 back
          here; no JavaScript needed). Delete opens the confirm page, which names the item. */}
      <section aria-labelledby="actions-heading" className="rounded-md border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 id="actions-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Actions
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <form method="post" action="/api/submissions/archive" className="contents">
            <input type="hidden" name="id" value={submission.id} />
            <input type="hidden" name="return" value={`/inbox/${submission.id}`} />
            <button
              type="submit"
              name="action"
              value={submission.status === "closed" ? "reopen" : "close"}
              className={BUTTON_OUTLINE}
            >
              {submission.status === "closed" ? "Reopen" : "Close"}
            </button>
            <button
              type="submit"
              name="action"
              value={submission.archivedAt ? "unarchive" : "archive"}
              className={BUTTON_OUTLINE}
            >
              {submission.archivedAt ? "Unarchive" : "Archive"}
            </button>
          </form>
          <Link href={`/inbox/delete?id=${submission.id}`} className={BUTTON_DANGER_OUTLINE}>
            Delete…
          </Link>
        </div>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Close marks it done and hides it from the list (a reply from the sender reopens it). Archive files it
          under Archived. Both keep the record and can be undone. Delete removes it for good, after a confirm step.
          {submission.archivedAt ? ` Archived ${submission.archivedAt.toLocaleString()}.` : ""}
        </p>
      </section>

      <section aria-label="Payload" className="rounded-md border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Submitted data</h2>
        <PayloadRenderer payload={submission.payload} />
      </section>

      <section aria-label="Status" className="rounded-md border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <StatusControl submissionId={submission.id} current={submission.status} />
      </section>

      <section aria-label="Reply" className="rounded-md border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Reply</h2>
        <ReplyComposer submissionId={submission.id} submitterEmail={submission.submitterEmail} />
      </section>

      {history.length > 0 ? (
        <section aria-label="Reply history" className="rounded-md border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">History</h2>
          <ol className="space-y-3">
            {history.map((r) => (
              <li key={r.id} className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <Badge tone={r.direction === "outbound" ? "sky" : "emerald"}>
                    {r.direction === "outbound" ? "Sent" : "Received"}
                  </Badge>
                  <time dateTime={r.sentAt.toISOString()}>{r.sentAt.toLocaleString()}</time>
                  {r.sentByEmail ? <span className="font-mono">{r.sentByEmail}</span> : null}
                </div>
                <p className="whitespace-pre-wrap text-sm text-slate-900 dark:text-slate-100">{r.body}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </main>
  );
}
