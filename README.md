# WitUS Inbox

A signed-webhook receiver, canonical-record store, and triage UI for solo operators running multi-product ecosystems. **One inbox for every form across every product you ship.**

> **Status:** v0 in production at [`inbox.witus.online`](https://inbox.witus.online), single-admin. Open-sourced 2026 to share the cross-product webhook pattern.

---

## What it is

Each of your products — landing pages, course platforms, scheduling tools, contact forms — POSTs a signed JSON webhook to one URL. This receiver verifies the signature, persists the submission, and surfaces it in a triage dashboard where you read, status-track, and reply.

Built because keeping eight products' submission inboxes in eight different admin panels (or Gmail filters) does not scale, and because everything-into-Airtable trades ergonomics for vendor lock.

```
                                                  ┌──────────────────────┐
landing page        ──────signed POST──────►      │                      │
SaaS app            ──────signed POST──────►      │   /api/ingest        │
course platform     ──────signed POST──────►      │   verifies HMAC,     │
contact form        ──────signed POST──────►      │   stores submission, │
…and so on                                        │   alerts on priority │
                                                  └──────────┬───────────┘
                                                             │
                                                  ┌──────────▼───────────┐
                                                  │   /inbox             │
                                                  │   triage UI:         │
                                                  │   filter, status,    │
                                                  │   reply (Mailgun),   │
                                                  │   reply history      │
                                                  └──────────────────────┘
```

## Who it's for

- Solo operators running 2+ products with their own form surfaces.
- Teams that want a *cross-product* triage layer without rebuilding each product's admin.
- Anyone who needs the contract spec for "signed JSON webhook → canonical record → human triage" and would rather fork than write it from scratch.

If you have one product and one form, this is overkill. Use Formspree.

## Stack

- **Next.js 16** App Router, TypeScript strict, React 19
- **Tailwind v4** + `@headlessui/react` + `lucide-react` + `class-variance-authority`
- **Drizzle ORM** + **Neon Postgres**
- **NextAuth v4** + EmailProvider via Mailgun SMTP (single-admin gate)
- **Mailgun HTTP API** for outbound replies
- **Mobile Text Alerts** for SMS on `priority=high` submissions (optional; falls back to dev-log when unset)

Every external dependency has a no-op / dev-log fallback so you can run the receiver without any third-party credentials.

## Quick start

> Detailed deploy guide arrives at `docs/deploy-vercel-neon.md` before launch.

```bash
git clone https://github.com/dapperAuteur/witus-inbox.git
cd witus-inbox
cp .env.example .env.local      # fill in values you have; rest can stay placeholder
npm install
npm run db:push                 # apply Drizzle schema to your Neon branch
npm run dev                     # http://localhost:3000
```

You'll need at least:

- A Neon Postgres branch (free tier is fine).
- An admin email address (set `ADMIN_EMAIL`).
- A 32-character random secret for `NEXTAUTH_SECRET` (`openssl rand -base64 32`).
- One `INGEST_SOURCES` entry per publisher product, e.g.:
  ```
  INGEST_SOURCES=[{"slug":"my-landing-page","hmac_secret":"<openssl rand -hex 32>"}]
  ```

For real outbound email (sign-in magic links + replies), you'll also need a Mailgun account with a verified sending domain. Without one, the `EmailProvider` will throw at sign-in and `lib/mailgun.ts` will dev-log replies instead of sending.

## The webhook contract

Every publisher product sends:

```http
POST /api/ingest
X-Witus-Source:    my-landing-page
X-Witus-Timestamp: 1761234567
X-Witus-Signature: sha256=<hex>
Content-Type:      application/json

{
  "form_type": "contact",
  "submitter_email": "alice@example.com",
  "submitter_name": "Alice",
  "priority": "normal",
  "payload": { …form fields… }
}
```

`X-Witus-Signature` is `HMAC-SHA256(secret, "${timestamp}.${rawBody}")`, hex-encoded. Replay window is 5 minutes; constant-time comparison.

Full spec, payload Zod schema, failure modes, and a working curl example: **[`docs/webhook-contract.md`](./docs/webhook-contract.md)**.

A working sender stub lives at [`scripts/smoke-test-bam-landing-page.ts`](./scripts/smoke-test-bam-landing-page.ts) — that's the reference implementation for a publisher product.

## Triage UI

`/inbox` lists submissions newest-first with source / form-type / status filters. `/inbox/[id]` opens a detail view: humanized payload, a status select (`new` → `in_progress` → `replied` → `waiting` → `closed`), and a reply composer that sends via Mailgun and threads outbound replies into a history list.

Inbound reply threading (parsing replies your submitters send back into the thread) is on the v1 roadmap.

## Contributing

Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) before opening a PR. The webhook contract is stable on purpose — PRs that change it need a design issue first.

## Security

Found a vulnerability? See [`SECURITY.md`](./SECURITY.md). Don't open a public issue.

## License

[MIT](./LICENSE) © 2026 Brand Anthony McDonald
