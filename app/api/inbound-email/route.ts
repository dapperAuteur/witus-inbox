import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { replies, submissions } from "@/db/schema";
import { getEnv } from "@/lib/env";
import { verifyMailgunWebhook } from "@/lib/mailgun-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUBADDRESS_RE = /^inbox\+([0-9a-f-]+)@/i;
const MAX_BODY_CHARS = 100_000;

function ok(): NextResponse {
  // Mailgun retries on non-2xx, so even soft failures (unknown submission,
  // duplicate, etc.) return 200 to stop the retry loop. Real signature /
  // config failures still return 401 / 500.
  return NextResponse.json({ ok: true });
}

function reject(status: number): NextResponse {
  return NextResponse.json({ ok: false }, { status });
}

/**
 * Mailgun inbound webhook receiver.
 *
 * Configure on Mailgun → Receiving → Routes:
 *   Match recipient: ^inbox\+.+@<MAILGUN_DOMAIN>$
 *   Action: forward(<INBOX_HOST>/api/inbound-email)
 *   Priority: 0
 *
 * Mailgun POSTs as multipart/form-data with the standard Stored-Messages
 * fields. The recipient subaddress encodes the submission UUID. We verify
 * the webhook signature, find the submission, and append an inbound reply
 * to the conversation.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const env = getEnv();
  if (!env.MAILGUN_WEBHOOK_SIGNING_KEY) {
    console.error("[inbound-email] refusing to accept: signing key unset");
    return reject(503);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return reject(400);
  }

  const timestamp = String(form.get("timestamp") ?? "");
  const token = String(form.get("token") ?? "");
  const signature = String(form.get("signature") ?? "");
  if (
    !verifyMailgunWebhook({
      signingKey: env.MAILGUN_WEBHOOK_SIGNING_KEY,
      timestamp,
      token,
      signature,
    })
  ) {
    console.warn("[inbound-email] signature verify failed");
    return reject(401);
  }

  const recipient = String(form.get("recipient") ?? "");
  const match = SUBADDRESS_RE.exec(recipient);
  if (!match || !UUID_RE.test(match[1])) {
    console.warn("[inbound-email] recipient not a subaddressed UUID");
    return ok();
  }
  const submissionId = match[1].toLowerCase();

  const sender = String(form.get("sender") ?? "").trim() || null;
  const messageId = String(form.get("Message-Id") ?? "").trim() || null;
  const stripped = String(form.get("stripped-text") ?? "").trim();
  const plain = String(form.get("body-plain") ?? "").trim();
  const body = (stripped || plain).slice(0, MAX_BODY_CHARS);
  if (body.length === 0) {
    console.warn("[inbound-email] empty body submission_id=%s", submissionId);
    return ok();
  }

  const db = getDb();
  let exists: { id: string; source: string; status: typeof submissions.$inferSelect.status } | undefined;
  try {
    const rows = await db
      .select({ id: submissions.id, source: submissions.source, status: submissions.status })
      .from(submissions)
      .where(eq(submissions.id, submissionId))
      .limit(1);
    exists = rows[0];
  } catch (err) {
    const code = err instanceof Error ? err.name : "UnknownError";
    console.error("[inbound-email] lookup failed id=%s err=%s", submissionId, code);
    return reject(500);
  }

  if (!exists) {
    console.warn("[inbound-email] unknown submission id=%s", submissionId);
    return ok();
  }

  try {
    const [inserted] = await db
      .insert(replies)
      .values({
        submissionId: exists.id,
        body,
        mailgunMessageId: messageId,
        direction: "inbound",
        sentByEmail: sender,
      })
      .returning({ id: replies.id });
    // Resurface the row in the triage queue: a fresh submitter reply
    // should pull a "replied" or "closed" submission back to the
    // operator's attention. Leave "in_progress" / "waiting" / "new" alone.
    if (exists.status === "replied" || exists.status === "closed") {
      await db
        .update(submissions)
        .set({ status: "in_progress" })
        .where(eq(submissions.id, exists.id));
    }
    console.log(
      "[inbound-email] received source=%s submission_id=%s reply_id=%s",
      exists.source,
      exists.id,
      inserted?.id
    );
  } catch (err) {
    const code = err instanceof Error ? err.name : "UnknownError";
    console.error("[inbound-email] persist failed id=%s err=%s", submissionId, code);
    return reject(500);
  }

  return ok();
}
