import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";
import { REDACTED, redactSecrets, scrubEvent } from "./sentry-scrub";

/**
 * The contract this file defends: nothing a crash report carries off to a third party may be a
 * working credential or another app's submitter data. The assertions are deliberately made against
 * the SERIALIZED event, because that is what actually leaves the process. A field we forgot to
 * scrub still shows up in the JSON even if every field-level assertion passes.
 */

// Shaped exactly like the real values this app handles: `openssl rand -hex 32` ingest secrets and
// 64-char hex HMAC-SHA256 signatures over `${timestamp}.${rawBody}` (see lib/hmac.ts).
const INGEST_SECRET = "9f2a4c8e1b7d3f605a9c8e2d4b6f80a1c3e5d7f9b1a3c5e7d9f0b2a4c6e8d0f2";
const SIGNATURE = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
const SESSION_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiYW0iLCJlbWFpbCI6ImJhbUBhd2V3cy5jb20ifQ.dQw4w9WgXcQ1234567890abcdefghijkl";
const SUBMITTER_EMAIL = "someone@partner-school.example";

function baseEvent(): ErrorEvent {
  return {
    type: undefined,
    message: `ingest failed for source=bam-landing-page signature=${SIGNATURE}`,
    exception: {
      values: [
        {
          type: "Error",
          value: `hmac_secret: ${INGEST_SECRET} rejected for ${SUBMITTER_EMAIL}`,
        },
      ],
    },
    user: {
      id: "usr_1",
      email: "bam@awews.com",
      ip_address: "203.0.113.9",
      username: "bam",
    },
    request: {
      url: `https://inbox.witus.online/api/ingest?token=${INGEST_SECRET}`,
      query_string: `token=${INGEST_SECRET}`,
      method: "POST",
      cookies: { "next-auth.session-token": SESSION_JWT },
      headers: {
        host: "inbox.witus.online",
        "content-type": "application/json",
        "x-witus-source": "bam-landing-page",
        "x-witus-signature": `sha256=${SIGNATURE}`,
        "x-witus-timestamp": "1769990400",
        authorization: `Bearer ${SESSION_JWT}`,
        cookie: `next-auth.session-token=${SESSION_JWT}`,
        "set-cookie": `next-auth.session-token=${SESSION_JWT}; Path=/`,
        "x-mailgun-signing-key": INGEST_SECRET,
        "x-api-key": INGEST_SECRET,
      },
      data: {
        form_type: "pilot-signup",
        submitter_email: SUBMITTER_EMAIL,
        payload: { message: "please contact me", phone: "+15555550123" },
      },
    },
    breadcrumbs: [
      {
        category: "fetch",
        message: `POST https://inbox.witus.online/api/ingest?token=${INGEST_SECRET}`,
        data: { authorization: `Bearer ${SESSION_JWT}`, url: `https://example.test/join/${INGEST_SECRET}` },
      },
    ],
    extra: { rawBody: `{"submitter_email":"${SUBMITTER_EMAIL}"}`, signingKey: INGEST_SECRET },
  } as ErrorEvent;
}

/** Every string that must never appear in the serialized payload. */
const FORBIDDEN = [INGEST_SECRET, SIGNATURE, SESSION_JWT, SUBMITTER_EMAIL, "bam@awews.com", "203.0.113.9"];

describe("scrubEvent", () => {
  it("leaks no secret in the serialized event", () => {
    const serialized = JSON.stringify(scrubEvent(baseEvent()));
    for (const secret of FORBIDDEN) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("deletes the request body outright", () => {
    const scrubbed = scrubEvent(baseEvent());
    expect(scrubbed.request?.data).toBeUndefined();
    expect(scrubbed.request?.cookies).toBeUndefined();
  });

  it("drops signature, secret, token, key, auth and cookie headers by name", () => {
    const headers = scrubEvent(baseEvent()).request?.headers as Record<string, string>;
    for (const dropped of [
      "x-witus-signature",
      "authorization",
      "cookie",
      "set-cookie",
      "x-mailgun-signing-key",
      "x-api-key",
    ]) {
      expect(headers[dropped]).toBeUndefined();
    }
    // Non-secret triage context survives, including the sending app's public slug.
    expect(headers.host).toBe("inbox.witus.online");
    expect(headers["x-witus-source"]).toBe("bam-landing-page");
  });

  it("removes the account identity and network origin", () => {
    const user = scrubEvent(baseEvent()).user;
    expect(user?.email).toBeUndefined();
    expect(user?.ip_address).toBeUndefined();
    expect(user?.username).toBeUndefined();
    expect(user?.id).toBe("usr_1"); // opaque id is fine, it is what makes the event triageable
  });

  it("keeps the event (never returns null) so the crash signal survives", () => {
    const scrubbed = scrubEvent(baseEvent());
    expect(scrubbed).toBeTruthy();
    expect(scrubbed.exception?.values?.[0]?.type).toBe("Error");
  });

  it("is idempotent", () => {
    const once = JSON.stringify(scrubEvent(baseEvent()));
    const twice = JSON.stringify(scrubEvent(JSON.parse(once) as ErrorEvent));
    expect(twice).toBe(once);
  });

  it("tolerates a bare event with no request, user or breadcrumbs", () => {
    const scrubbed = scrubEvent({ message: "boom" } as ErrorEvent);
    expect(scrubbed.message).toBe("boom");
  });
});

describe("redactSecrets", () => {
  it("redacts token-bearing URLs but keeps ordinary ones", () => {
    expect(redactSecrets("see https://inbox.witus.online/inbox for triage")).toContain(
      "https://inbox.witus.online/inbox"
    );
    expect(redactSecrets(`open https://inbox.witus.online/inbox?token=${SIGNATURE}`)).not.toContain(
      SIGNATURE
    );
    expect(redactSecrets("open https://witus.online/join/abcdefghijklmnop123")).toContain(
      "[redacted link]"
    );
  });

  it("redacts labelled secrets, JWTs, long hex digests and emails", () => {
    expect(redactSecrets("signing_key = hunter2hunter2hunter2")).toContain(REDACTED);
    expect(redactSecrets(`session ${SESSION_JWT}`)).not.toContain(SESSION_JWT);
    expect(redactSecrets(`digest ${SIGNATURE}`)).toBe(`digest ${REDACTED}`);
    expect(redactSecrets("mail to someone@partner-school.example now")).not.toContain(
      "someone@partner-school.example"
    );
  });

  it("leaves a submission UUID intact so an event stays traceable to a row", () => {
    const uuid = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    expect(redactSecrets(`submission ${uuid} not found`)).toContain(uuid);
  });

  it("leaves ordinary prose about signatures alone", () => {
    expect(redactSecrets("the signature check failed")).toBe("the signature check failed");
  });
});
