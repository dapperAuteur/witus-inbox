import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/db";
import { replies, submissions } from "@/db/schema";
import { getEnv } from "@/lib/env";
import { inboxFromAddress, sendMail } from "@/lib/mailgun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ReplyBody = z.object({
  body: z.string().min(1).max(20_000),
  subject: z.string().min(1).max(300).optional(),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  const adminEmail = session?.user?.email;
  if (!adminEmail) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const { id } = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const parsed = ReplyBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const db = getDb();

  // Look up the original submission to resolve the recipient + derive a
  // default subject. Wrapped in try/catch per plans/00 §3: this SELECT
  // returns submitter_email + payload, so an unhandled error would leak
  // both into server logs.
  let submission: {
    source: string;
    formType: string;
    submitterEmail: string | null;
    submitterName: string | null;
  } | undefined;
  try {
    const rows = await db
      .select({
        source: submissions.source,
        formType: submissions.formType,
        submitterEmail: submissions.submitterEmail,
        submitterName: submissions.submitterName,
      })
      .from(submissions)
      .where(eq(submissions.id, id))
      .limit(1);
    submission = rows[0];
  } catch (err) {
    const code = err instanceof Error ? err.name : "UnknownError";
    console.error("[reply] lookup failed id=%s err=%s", id, code);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  if (!submission) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  if (!submission.submitterEmail) {
    console.warn("[reply] no submitter_email source=%s id=%s", submission.source, id);
    return NextResponse.json({ ok: false, reason: "no-submitter-email" }, { status: 422 });
  }

  const subject =
    parsed.data.subject ?? `Re: your ${submission.source}/${submission.formType} submission`;
  const env = getEnv();

  const mailResult = await sendMail({
    to: submission.submitterEmail,
    from: inboxFromAddress(),
    replyTo: env.BVC_SUBMISSIONS_EMAIL,
    subject,
    text: parsed.data.body,
    headers: {
      "X-Witus-Inbox-Submission": id,
    },
  });

  if (!mailResult.ok) {
    console.error(
      "[reply] mailgun failed source=%s id=%s detail=%s",
      submission.source,
      id,
      mailResult.detail
    );
    return NextResponse.json({ ok: false }, { status: 502 });
  }

  try {
    const [inserted] = await db
      .insert(replies)
      .values({
        submissionId: id,
        body: parsed.data.body,
        mailgunMessageId: mailResult.detail ?? null,
        direction: "outbound",
        sentByEmail: adminEmail,
      })
      .returning({ id: replies.id });
    await db
      .update(submissions)
      .set({ status: "replied" })
      .where(eq(submissions.id, id));
    console.log(
      "[reply] sent source=%s id=%s reply_id=%s",
      submission.source,
      id,
      inserted?.id
    );
    return NextResponse.json({ ok: true, reply_id: inserted?.id }, { status: 200 });
  } catch (err) {
    const code = err instanceof Error ? err.name : "UnknownError";
    console.error("[reply] persist failed id=%s err=%s", id, code);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
