/**
 * Reference sender for the WitUS Inbox signed-webhook contract.
 *
 * Copy this file into your publisher product (or import from this repo) and
 * call `sendToInbox(...)` after your form's user-facing response is rendered.
 * Dependency-free apart from Node's built-in `crypto` module and the runtime
 * `fetch`.
 *
 * Contract: see ../docs/webhook-contract.md.
 *
 * Three rules for callers:
 *   1. Sign the exact bytes you send. Don't re-serialize JSON between hashing
 *      and POSTing; whitespace, key order, and number formatting matter.
 *   2. Don't block the user-facing response on this. Fire-and-forget after
 *      your "thank you" page renders (for example, via Next.js `after()`).
 *   3. Log at most `source`, `form_type`, and the HTTP status. Never log the
 *      submission body, the secret, or the signature.
 */
import { createHmac } from "node:crypto";

export interface InboxSubmission {
  form_type: string;
  submitter_email?: string;
  submitter_name?: string;
  priority?: "normal" | "high";
  payload: Record<string, unknown>;
}

export interface SendArgs {
  /** Full URL of the receiver, e.g. `https://inbox.your-domain.example/api/ingest`. */
  inboxUrl: string;
  /** Lowercase kebab slug; must match an entry in the receiver's `INGEST_SOURCES`. */
  sourceSlug: string;
  /** Same `hmac_secret` the receiver has configured for this slug. ≥32 chars. */
  hmacSecret: string;
  submission: InboxSubmission;
}

export interface SendResult {
  ok: boolean;
  status: number;
  /** UUID assigned by the receiver on success. */
  id?: string;
  /** Raw response body when `ok` is false; useful for logs. */
  detail?: string;
}

export async function sendToInbox(args: SendArgs): Promise<SendResult> {
  const rawBody = JSON.stringify(args.submission);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", args.hmacSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  const res = await fetch(args.inboxUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Witus-Source": args.sourceSlug,
      "X-Witus-Timestamp": timestamp,
      "X-Witus-Signature": `sha256=${signature}`,
    },
    body: rawBody,
  });

  const text = await res.text();
  let body: { ok?: boolean; id?: string } = {};
  try {
    body = JSON.parse(text);
  } catch {
    /* leave empty */
  }

  if (res.ok && body.ok && body.id) {
    return { ok: true, status: res.status, id: body.id };
  }
  return { ok: false, status: res.status, detail: text };
}
