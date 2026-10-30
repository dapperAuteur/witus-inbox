import { NextResponse, type NextRequest } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/db";
import { submissions } from "@/db/schema";
import {
  doneKeyFor,
  isSameOrigin,
  parseArchiveForm,
  parseArchiveJson,
  returnUrlWithNotice,
  safeReturnPath,
  type ArchiveRequest,
} from "@/lib/archive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The reversible triage actions on one or many submissions:
 *   archive / unarchive  set or clear `archived_at`;
 *   close                set `status` to closed (hidden from the default list);
 *   reopen               set a closed submission back to in_progress.
 * Nothing is deleted here: permanent delete is POST /api/submissions/delete, behind
 * a confirm page. proxy.ts already limits /api/submissions/* to the admin; the
 * session check here is the second lock, as in the status route.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!isSameOrigin(request.headers.get("origin"), host)) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  const isJson = (request.headers.get("content-type") ?? "").includes("application/json");
  let parsed: ArchiveRequest | null = null;
  let form: FormData | null = null;
  try {
    if (isJson) {
      parsed = parseArchiveJson(await request.json());
    } else {
      form = await request.formData();
      parsed = parseArchiveForm(form);
    }
  } catch {
    parsed = null;
  }
  if (!parsed) {
    if (isJson) return NextResponse.json({ ok: false }, { status: 400 });
    // A bulk form submitted with nothing ticked lands here: back to the same view,
    // no notice.
    return NextResponse.redirect(new URL(safeReturnPath(form?.get("return")), request.url), 303);
  }

  let count = 0;
  try {
    const db = getDb();
    const ids = inArray(submissions.id, parsed.ids);
    const returning = { id: submissions.id };
    let updated: Array<{ id: string }>;
    switch (parsed.action) {
      case "archive":
      case "unarchive":
        updated = await db
          .update(submissions)
          .set({ archivedAt: parsed.action === "archive" ? new Date() : null })
          .where(ids)
          .returning(returning);
        break;
      case "close":
        updated = await db.update(submissions).set({ status: "closed" }).where(ids).returning(returning);
        break;
      case "reopen":
        // Only closed rows: reopening must not reset a "waiting" or "replied" one.
        updated = await db
          .update(submissions)
          .set({ status: "in_progress" })
          .where(and(ids, eq(submissions.status, "closed")))
          .returning(returning);
        break;
    }
    count = updated.length;
  } catch (err) {
    const code = err instanceof Error ? err.name : "UnknownError";
    console.error("[archive] %s failed ids=%d err=%s", parsed.action, parsed.ids.length, code);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  console.log("[archive] action=%s requested=%d updated=%d", parsed.action, parsed.ids.length, count);
  if (isJson) return NextResponse.json({ ok: true, updated: count }, { status: 200 });
  return NextResponse.redirect(
    new URL(returnUrlWithNotice(parsed.returnTo, doneKeyFor(parsed.action), count), request.url),
    303,
  );
}
