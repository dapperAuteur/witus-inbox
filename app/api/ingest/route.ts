import { NextResponse, after, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { submissions } from "@/db/schema";
import { getEnv } from "@/lib/env";
import { signPayload, verifySignature } from "@/lib/hmac";
import { getSourceSecret } from "@/lib/ingest-sources";
import { sendSms } from "@/lib/sms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IngestPayload = z.object({
  form_type: z.string().min(1).max(120),
  submitter_email: z.string().email().max(255).optional(),
  submitter_name: z.string().min(1).max(255).optional(),
  priority: z.enum(["normal", "high"]).default("normal"),
  payload: z.record(z.string(), z.unknown()),
});

function reject(status: number): NextResponse {
  return NextResponse.json({ ok: false }, { status });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const source = request.headers.get("x-witus-source");
  const timestamp = request.headers.get("x-witus-timestamp");
  const signatureHeader = request.headers.get("x-witus-signature");

  if (!source || !timestamp || !signatureHeader) {
    return reject(401);
  }

  const secret = getSourceSecret(source);
  if (!secret) {
    console.warn("[ingest] unknown source");
    return reject(401);
  }

  const signature = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice("sha256=".length)
    : signatureHeader;

  const rawBody = await request.text();

  if (!verifySignature({ secret, timestamp, rawBody, signature })) {
    console.warn("[ingest] hmac verify failed source=%s", source);
    return reject(401);
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    console.warn("[ingest] invalid JSON source=%s", source);
    return reject(400);
  }

  const parsed = IngestPayload.safeParse(json);
  if (!parsed.success) {
    console.warn("[ingest] schema invalid source=%s", source);
    return reject(400);
  }

  const db = getDb();
  let submissionId: string | undefined;
  try {
    const inserted = await db
      .insert(submissions)
      .values({
        source,
        formType: parsed.data.form_type,
        submitterEmail: parsed.data.submitter_email ?? null,
        submitterName: parsed.data.submitter_name ?? null,
        payload: parsed.data.payload,
        priority: parsed.data.priority,
        receivedVia: "webhook",
      })
      .returning({ id: submissions.id });
    submissionId = inserted[0]?.id;
  } catch (err) {
    // Log error code only. Drizzle includes query params (which include
    // submitter email + payload) in its default error shape; never surface that.
    const code = err instanceof Error ? err.name : "UnknownError";
    console.error("[ingest] insert failed source=%s err=%s", source, code);
    return reject(500);
  }

  if (!submissionId) {
    console.error("[ingest] insert returned no id source=%s", source);
    return reject(500);
  }

  console.log(
    "[ingest] accepted source=%s form_type=%s id=%s",
    source,
    parsed.data.form_type,
    submissionId
  );

  if (parsed.data.priority === "high") {
    const result = await sendSms({
      text: `WitUS Inbox: new high-priority ${source}/${parsed.data.form_type}. Triage at https://inbox.witus.online/inbox/${submissionId}`,
    });
    if (!result.ok) {
      console.error("[sms] failed detail=%s", result.detail);
    }
  }

  // Fire-and-forget: hand the full submission to the WitUS Triage Agent. The
  // agent owns its own DB, so it needs the whole payload, not just an id.
  // Skipped silently when either env var is unset (e.g. local dev). Runs via
  // after() so a slow/failed triage call never delays or fails this response.
  const triageUrl = getEnv().TRIAGE_START_URL;
  const triageSecret = getEnv().TRIAGE_INGEST_SECRET;

  if (triageUrl && triageSecret) {
    after(async () => {
      try {
        const body = JSON.stringify({
          submissionId,
          source,
          formType: parsed.data.form_type,
          submitterEmail: parsed.data.submitter_email ?? null,
          submitterName: parsed.data.submitter_name ?? null,
          payload: parsed.data.payload,
          priority: parsed.data.priority,
          receivedAt: new Date().toISOString(),
        });
        const { timestamp, signature } = signPayload(triageSecret, body);
        const res = await fetch(triageUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-triage-timestamp": timestamp,
            "x-triage-signature": `sha256=${signature}`,
          },
          body,
          cache: "no-store",
        });
        if (!res.ok) {
          console.error("[triage] start webhook rejected status=%d", res.status);
        }
      } catch (err) {
        // Error code only — never surface the URL or payload.
        const code = err instanceof Error ? err.name : "UnknownError";
        console.error("[triage] start webhook failed err=%s", code);
      }
    });
  }

  return NextResponse.json({ ok: true, id: submissionId }, { status: 200 });
}
