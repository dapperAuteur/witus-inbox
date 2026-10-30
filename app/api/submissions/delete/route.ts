import { NextResponse, type NextRequest } from "next/server";
import { inArray } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/db";
import { replies, submissions } from "@/db/schema";
import { getEnv } from "@/lib/env";
import { isSameOrigin, returnUrlWithNotice } from "@/lib/archive";
import { isAdminEmail, listReturnPath, parseDeleteForm, parseDeleteJson, type DeleteRequest } from "@/lib/delete";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Permanently delete one or many submissions and their reply history. Reached from
 * the confirm page at /inbox/delete, which names every item first; the body must
 * carry `confirm=delete`. Cannot be undone: Close or Archive hide an item and keep it.
 *
 * Locks, in order: proxy.ts (admin only on /api/submissions/*), a session whose
 * email is ADMIN_EMAIL, a same-origin check for form posts, and the confirm field.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  if (!isAdminEmail(session.user.email, getEnv().ADMIN_EMAIL)) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!isSameOrigin(request.headers.get("origin"), host)) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  const isJson = (request.headers.get("content-type") ?? "").includes("application/json");
  let parsed: DeleteRequest | null = null;
  let form: FormData | null = null;
  try {
    if (isJson) {
      parsed = parseDeleteJson(await request.json());
    } else {
      form = await request.formData();
      parsed = parseDeleteForm(form);
    }
  } catch {
    parsed = null;
  }
  if (!parsed) {
    if (isJson) return NextResponse.json({ ok: false }, { status: 400 });
    return NextResponse.redirect(new URL(listReturnPath(form?.get("return")), request.url), 303);
  }

  let count = 0;
  try {
    // One transaction (neon-http batch): the reply rows go first, so the delete does
    // not depend on the database having the ON DELETE CASCADE that db/schema.ts declares.
    const db = getDb();
    const [, deleted] = await db.batch([
      db.delete(replies).where(inArray(replies.submissionId, parsed.ids)),
      db.delete(submissions).where(inArray(submissions.id, parsed.ids)).returning({ id: submissions.id }),
    ]);
    count = deleted.length;
  } catch (err) {
    const code = err instanceof Error ? err.name : "UnknownError";
    console.error("[delete] failed ids=%d err=%s", parsed.ids.length, code);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  // Counts only: no ids, names or emails in the log line.
  console.log("[delete] requested=%d deleted=%d", parsed.ids.length, count);
  if (isJson) return NextResponse.json({ ok: true, deleted: count }, { status: 200 });
  return NextResponse.redirect(new URL(returnUrlWithNotice(parsed.returnTo, "deleted", count), request.url), 303);
}
