import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_SKEW_SECONDS = 5 * 60;

export interface MailgunWebhookSignature {
  /** Unix-seconds string from the Mailgun payload's `timestamp` field. */
  timestamp: string;
  /** Random per-message string from the Mailgun payload's `token` field. */
  token: string;
  /** Hex-encoded HMAC-SHA256 from the Mailgun payload's `signature` field. */
  signature: string;
}

export interface VerifyMailgunWebhookArgs extends MailgunWebhookSignature {
  signingKey: string;
}

/**
 * Verify a Mailgun HTTP webhook payload's signature. Mailgun's scheme:
 *
 *   signature = HMAC_SHA256(signingKey, timestamp + token)
 *
 * Plus a 5-minute timestamp skew check to limit replay surface. Constant-time
 * compare on the hex digest. The signing key is the "HTTP webhook signing key"
 * from the Mailgun dashboard (Sending → Webhooks), NOT the SMTP password and
 * NOT the Private API key.
 *
 * Returns false on any malformed input. Caller should treat false as 401.
 */
export function verifyMailgunWebhook({
  signingKey,
  timestamp,
  token,
  signature,
}: VerifyMailgunWebhookArgs): boolean {
  if (!signingKey || !timestamp || !token || !signature) return false;

  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MAX_SKEW_SECONDS) return false;

  const expected = createHmac("sha256", signingKey)
    .update(`${timestamp}${token}`)
    .digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
