# Examples

Reference code for callers wiring their publisher products to a WitUS Inbox receiver.

| File | Purpose |
|---|---|
| [`sender.ts`](./sender.ts) | Dependency-free TypeScript sender library. Single exported function `sendToInbox`. About 75 lines. Copy into your publisher product or import from this repo. |

## Quickest possible integration

```ts
import { sendToInbox } from "./sender";

const result = await sendToInbox({
  inboxUrl:    process.env.INBOX_INGEST_URL!,    // e.g. https://inbox.example.com/api/ingest
  sourceSlug:  process.env.INBOX_SOURCE_SLUG!,   // your publisher slug, e.g. "my-landing-page"
  hmacSecret:  process.env.INBOX_INGEST_SECRET!, // matches the receiver's hmac_secret for this slug
  submission: {
    form_type: "contact",
    submitter_email: form.email,
    submitter_name: form.name,
    priority: "normal",
    payload: form,                                 // anything JSON-serializable
  },
});

if (!result.ok) {
  console.error("[inbox] failed", { status: result.status, source: process.env.INBOX_SOURCE_SLUG });
}
```

The function returns `{ ok, status, id?, detail? }`. On success, `id` is the submission UUID the receiver assigned. On failure, `status` is the HTTP code and `detail` is the raw response body (useful for the rare debugging session, not for production logs).

## Use from a Next.js Server Action

```ts
"use server";
import { after } from "next/server";
import { sendToInbox } from "@/examples/sender";

export async function submitContactForm(formData: FormData) {
  // 1. Persist + render the user-facing response immediately.
  const submission = await persistLocally(formData);
  const userResponse = renderThankYou(submission);

  // 2. Fire-and-forget the inbox call after the response is sent.
  after(async () => {
    await sendToInbox({
      inboxUrl:   process.env.INBOX_INGEST_URL!,
      sourceSlug: process.env.INBOX_SOURCE_SLUG!,
      hmacSecret: process.env.INBOX_INGEST_SECRET!,
      submission: {
        form_type: "contact",
        submitter_email: formData.get("email")?.toString(),
        submitter_name:  formData.get("name")?.toString(),
        priority: "normal",
        payload: Object.fromEntries(formData),
      },
    });
  });

  return userResponse;
}
```

`after()` keeps the network call off the user's response path. The submitter sees their thank-you page in under 100ms; the inbox handoff happens in the background.

## Use from an Express / Hono / Fastify handler

```ts
app.post("/api/contact", async (req, res) => {
  const submission = await persistLocally(req.body);
  res.json({ ok: true, id: submission.id });

  // Fire-and-forget after the response is committed.
  sendToInbox({
    inboxUrl:   process.env.INBOX_INGEST_URL!,
    sourceSlug: process.env.INBOX_SOURCE_SLUG!,
    hmacSecret: process.env.INBOX_INGEST_SECRET!,
    submission: {
      form_type: "contact",
      submitter_email: req.body.email,
      payload: req.body,
    },
  }).catch((err) => {
    console.error("[inbox] failed", {
      source: process.env.INBOX_SOURCE_SLUG,
      err: err instanceof Error ? err.name : "UnknownError",
    });
  });
});
```

## Sender from another language

Any HTTP client and HMAC-SHA256 library will do. The only invariants:

1. Sign **exactly** `${unix_timestamp}.${request_body_bytes}`. No trimming, no re-encoding.
2. Send the same `request_body_bytes` you signed, byte-for-byte. JSON whitespace and key order are part of the signature.
3. Header names are lowercase-with-hyphens-via-HTTP-convention but you'll usually write them as `X-Witus-Source`, `X-Witus-Timestamp`, `X-Witus-Signature`.

A working `curl` reference lives in [`docs/webhook-contract.md`](../docs/webhook-contract.md#working-curl-example).

## What's NOT here

- A "test runner" CLI. See [`scripts/smoke-test-bam-landing-page.ts`](../scripts/smoke-test-bam-landing-page.ts) for an opinionated end-to-end smoke test you can adapt to your own slug.
- Inbound reply handling. That's a v1 receiver feature, not a sender concern.
- A retry queue. Fire-and-forget is the contract. If you need durable delivery, wrap `sendToInbox` in your queue of choice (BullMQ, Vercel Queues, etc.) and retry on `result.ok === false`.
