import { NextResponse, type NextRequest } from "next/server";
import { inArray } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/db";
import { submissions } from "@/db/schema";
import {
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
 * Archive or unarchive one or many submissions. Archiving sets `archived_at`;
 * unarchiving clears it. Nothing is deleted: the row, its replies and its status
 * stay as they were. proxy.ts already limits /api/submissions/* to the admin; the
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
    const updated = await getDb()
      .update(submissions)
      .set({ archivedAt: parsed.archived ? new Date() : null })
      .where(inArray(submissions.id, parsed.ids))
      .returning({ id: submissions.id });
    count = updated.length;
  } catch (err) {
    const code = err instanceof Error ? err.name : "UnknownError";
    console.error("[archive] update failed ids=%d err=%s", parsed.ids.length, code);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  console.log("[archive] archived=%s requested=%d updated=%d", parsed.archived, parsed.ids.length, count);
  if (isJson) return NextResponse.json({ ok: true, updated: count }, { status: 200 });
  return NextResponse.redirect(
    new URL(returnUrlWithNotice(parsed.returnTo, parsed.archived, count), request.url),
    303,
  );
}
