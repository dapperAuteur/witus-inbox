# Examples

Reference code and adoption guide for callers wiring their publisher products to a WitUS Inbox receiver.

| File | Purpose |
|---|---|
| [`sender.ts`](./sender.ts) | Dependency-free TypeScript sender library. Single exported function `sendToInbox`. About 75 lines. Copy into your publisher product or import from this repo. |

## Table of contents

- [Quickest possible integration](#quickest-possible-integration)
- [Use from a Next.js Server Action](#use-from-a-nextjs-server-action)
- [Use from an Express / Hono / Fastify handler](#use-from-an-express--hono--fastify-handler)
- [Sender from another language](#sender-from-another-language)
- [**Adding a new publisher product**](#adding-a-new-publisher-product) — step-by-step adoption guide
- [What's NOT here](#whats-not-here)

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
    // IMPORTANT: do NOT use `Object.fromEntries(formData)`. FormData repeats
    // keys for multi-selects (`<input type="checkbox" name="grades" />` etc.);
    // fromEntries silently keeps only the last value. Use `formData.getAll()`
    // for any field that can repeat, even if today's form only has one.
    const email = String(formData.get("email") ?? "").trim();
    const name  = String(formData.get("name") ?? "").trim();

    await sendToInbox({
      inboxUrl:   process.env.INBOX_INGEST_URL!,
      sourceSlug: process.env.INBOX_SOURCE_SLUG!,
      hmacSecret: process.env.INBOX_INGEST_SECRET!,
      submission: {
        form_type: "contact",
        priority: "normal",
        // Omit submitter_* keys when empty so the receiver never stores
        // empty-string rows. Important when fields are optional.
        ...(email && { submitter_email: email }),
        ...(name  && { submitter_name:  name  }),
        payload: {
          // Build by hand. Use formData.getAll() for known multi-selects.
          subjects: formData.getAll("subjects").map(String).filter(Boolean),
          message: String(formData.get("message") ?? ""),
        },
      },
    });
  });

  return userResponse;
}
```

`after()` (added in Next.js 15) keeps the network call off the user's response path. The submitter sees their thank-you page in under 100ms; the inbox handoff happens in the background. On Next 14 or older, use `waitUntil` from `@vercel/functions` instead.

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

---

# Adding a new publisher product

This is the canonical onboarding sequence for wiring a new publisher product (a landing page, app, or service in your ecosystem) to send signed webhooks to the WitUS Inbox receiver.

The two existing reference implementations are `bam-landing-page` (`/hire`, `/partner`) and `witus-online` (`/educators`, `/educators/feedback`). The wiring docs for the latter live at `witus-online/plans/handoff-from-witus-inbox/witus-online-inbox-sender-wiring.md` (gitignored in that repo, available to its agent) and are a worked example of this guide.

## Step 1 — Pick a source slug

The slug identifies your publisher to the receiver. Conventions:

- **Lowercase kebab-case.** `flashlearn-ai`, not `FlashlearnAI` or `flashlearn_ai`.
- **One slug per publishing host**, not per form. A single slug covers all forms on `flashlearn.example.com`. Multiple `form_type` values discriminate within the slug.
- **Match the deployed hostname** when sensible: `witus-online` for `witus.online`, `bam-landing-page` for the `bam-landing-page` repo (which serves `brandanthonymcdonald.com`).
- **Avoid collisions.** The authoritative list is the receiver's `INGEST_SOURCES` env var on the witus-inbox Vercel project — check it before picking a slug.
- **Once chosen, never change.** The slug is part of stored submissions' canonical record. Renaming requires a backfill.

## Step 2 — Pick `form_type` values

`form_type` discriminates between forms within a single publisher. Conventions:

- **Lowercase kebab-case**, like the slug.
- **Verb-noun or domain-noun**, not generic. `pilot-signup` and `bvc-feedback` (not `form1` and `form2`).
- **Stable across publishers' analogues.** If three products have a "newsletter signup" form, all three use `form_type: "newsletter-signup"` — that lets the receiver group cross-product analytics.
- **Embed the domain prefix when ambiguous.** `bvc-pilot-signup` and `bvc-feedback` (BVC = the BVC pilot context) is clearer than `pilot-signup` alone if your product hosts multiple unrelated pilots.

## Step 3 — Pick a priority per form

`priority` controls receiver-side fan-out (e.g. SMS alerts on `high`, dashboard-only on `normal`).

| Priority | Use for | Receiver-side behavior |
|---|---|---|
| `high` | Hot leads — paying-customer-today signups, urgent partnership requests, anything where >2h response delay materially costs money or trust | SMS alert + dashboard row |
| `normal` (default) | Feedback, surveys, contact forms, general inquiries | Dashboard row only |

If you're unsure, default to `normal`. Bumping `normal` to `high` later is a one-line change; the inverse means SMS-fatigue.

## Step 4 — Pre-flight (operator-side, before the smoke test)

The signed webhook needs distinct shared secrets per environment. Generate three, then wire them through both Vercel projects.

**Always log this as an operator-task file in your publisher repo's `./plans/user-tasks/` queue.** That file is what the next session reads at startup; without it, the steps below get lost and the wiring ships 401s. Reference shape: `witus-online/plans/user-tasks/20-inbox-sender-secret-provisioning.md` (or its analogue in your repo).

### 4a. Generate three secrets

```sh
openssl rand -hex 32   # prod
openssl rand -hex 32   # preview
openssl rand -hex 32   # local
```

Save all three in your password manager labeled by env. Receiver enforces ≥32 chars; `openssl rand -hex 32` produces 64.

### 4b. Receiver side (witus-inbox Vercel project)

For **Production** AND **Preview**, edit `INGEST_SOURCES`. Append your slug; don't replace existing entries:

```json
[
  {"slug":"existing-publisher","hmac_secret":"<existing value>"},
  {"slug":"<your-new-slug>","hmac_secret":"<prod or preview secret>"}
]
```

For local dev, do the same in `witus-inbox/.env.local` with the local secret.

### 4c. Publisher side (your project's Vercel)

For **Production** AND **Preview**, add three env vars:

| Var | Production | Preview |
|---|---|---|
| `INBOX_INGEST_URL` | `https://inbox.<your-domain>/api/ingest` | same |
| `INBOX_SOURCE_SLUG` | `<your-slug>` | `<your-slug>` |
| `INBOX_INGEST_SECRET` | `<prod secret>` | `<preview secret>` |

For local dev, set the same three in your repo's `.env.local` with `INBOX_INGEST_URL=http://localhost:3000/api/ingest` and the local secret.

### 4d. Document and confirm

Update your repo's `.env.example` with placeholder rows for the three new vars. Confirm in your operator-task file that all three secrets are saved and all four locations (receiver prod, receiver preview, publisher prod, publisher preview) are wired. Do not run the smoke test until this is done — every signed POST will return 401 from the receiver.

## Step 5 — Wire the form action

Three rules — break any and the integration silently degrades:

1. **Don't block the user.** The inbox call goes inside `after()` (Next.js 15+), `waitUntil` (older Vercel runtimes), or post-`res.send()` fire-and-forget (Express/Hono/Fastify). Never inline before the user response.
2. **Log only `source`, `form_type`, `http_status`.** Never log the body, the secret, the signature, the `submitter_*` fields, or anything from `payload`. Logs end up in shared infra; PII in logs is a compliance liability.
3. **Don't throw.** If the inbox is down, your user's submission flow must still succeed — the inbox is a side-channel, not a system of record. If your only persistence is the inbox, add a local fallback (file, DB, email) before wiring this in.

### Five common gotchas

- **`Object.fromEntries(formData)` drops multi-select values.** FormData stores `<input type="checkbox" name="grades" />` as repeated keys; `fromEntries` keeps only the last. Use `formData.getAll(name)` for every field that has more than one input with that name. When in doubt, use `getAll` — it returns `[]` for absent keys, which is harmless.
- **Empty-string `submitter_*` fields** (when fields are optional) create receiver rows with `submitter_email: ""`. Omit the key entirely with the spread pattern: `...(email && { submitter_email: email })`.
- **`process.env.X!` crashes at runtime if X is unset.** This is fine in production where pre-flight ensures it's set, but in dev environments without the env vars wired up, the action crashes on every submit. If you need graceful degradation, guard the call: `if (!process.env.INBOX_INGEST_SECRET) return;`.
- **Signing whitespace matters.** If you serialize the body twice (once for signing, once for sending), key order or whitespace can drift between them. The reference `sender.ts` solves this by serializing once and reusing the bytes — don't restructure that.
- **5-minute replay window.** The receiver rejects timestamps older than 5 minutes. If your runtime clock drifts (uncommon on managed platforms, common in self-hosted VMs), expect 401s. The error logs `[ingest] timestamp out of window`.

### Pattern for forms behind third-party handlers (Tally, Typeform, Formspree)

If your form's submission goes to a third-party service first, point the third-party's webhook at a small adapter route in your repo:

```ts
// app/api/webhooks/tally/route.ts (Next.js App Router example)
import { sendToInbox } from "@/lib/inbox-sender";

export async function POST(req: Request) {
  // Verify the third-party's signature first (Tally HMAC, etc.)
  const body = await req.json();

  // Translate the third-party's shape into the inbox contract.
  await sendToInbox({
    inboxUrl:   process.env.INBOX_INGEST_URL!,
    sourceSlug: process.env.INBOX_SOURCE_SLUG!,
    hmacSecret: process.env.INBOX_INGEST_SECRET!,
    submission: {
      form_type: "contact",
      priority: "normal",
      submitter_email: body.fields.email,
      payload: body,
    },
  });

  return Response.json({ ok: true });
}
```

Two signatures get verified: the third-party's (theirs to you) and yours (you to the inbox). Don't conflate them.

## Step 6 — Verify

Local end-to-end smoke. Both repos running:

1. **Receiver:** `cd <witus-inbox path> && npm run dev` (port 3000). Confirm `.env.local`'s `INGEST_SOURCES` includes your slug with the local secret.
2. **Publisher:** `cd <your-repo> && npm run dev -- -p 3001` (or whatever port avoids :3000). Confirm `.env.local` has the three INBOX_* vars matching the receiver's local secret.
3. **Submit each form.** Receiver should log `[ingest] accepted source=<your-slug> form_type=<your-form_type> id=<uuid>`. No PII in that log line — if there is, your sender or your code is leaking.
4. **Inspect a receiver DB row** (drizzle-studio, `psql`, or the receiver's `/inbox` admin UI). Confirm the submission shows the right slug, form_type, priority, and complete `payload` (multi-selects intact as arrays).
5. **Negative test 1: receiver down.** Kill receiver, submit on publisher. User-facing flow unaffected. Publisher logs `[inbox-sender] failed http_status=0` (fetch error). If the user sees an error, you broke rule 3.
6. **Negative test 2: wrong secret.** Set publisher's `INBOX_INGEST_SECRET` to garbage, restart, submit. Receiver logs `[ingest] hmac verify failed source=<slug>`. Publisher logs `http_status=401`.
7. **PII grep.** `grep -i "<your test email>" <terminal output>` in both terminals. Zero hits in both. If either contains it, you violated rule 2.

Production smoke (after merge + deploy): submit a real form on your deployed URL, confirm a row appears in `https://inbox.witus.online/inbox` with your slug and the right form_type.

## Step 7 — Branch, commit, push (don't merge)

Per ecosystem convention:

1. All work on a feature branch (`feat/NN-inbox-sender`, where NN is the next free plan number in your repo).
2. Stage explicitly — never `git add .`. Typical file list: `lib/inbox-sender.ts` (new), the modified action handler(s), `.env.example` (new or updated).
3. Commit with a descriptive message (build + smoke status, what slug + form_types you registered).
4. Push to origin. Stop. The repo owner reviews and merges from GitHub.

---

## What's NOT here

- A "test runner" CLI. See [`scripts/smoke-test-bam-landing-page.ts`](../scripts/smoke-test-bam-landing-page.ts) for an opinionated end-to-end smoke test you can adapt to your own slug.
- Inbound reply handling. That's a v1 receiver feature, not a sender concern.
- A retry queue. Fire-and-forget is the contract. If you need durable delivery, wrap `sendToInbox` in your queue of choice (BullMQ, Vercel Queues, etc.) and retry on `result.ok === false`.
- A registry of all currently-wired slugs. Source of truth is the receiver's `INGEST_SOURCES` Vercel env var; consult it before picking a new slug to avoid collisions.
