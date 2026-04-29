# WitUS Inbox

A signed-webhook receiver, canonical-record store, and triage UI for solo operators running multi-product ecosystems. **One inbox for every form across every product you ship.**

> **Status:** v0 in production at [`inbox.witus.online`](https://inbox.witus.online), single-admin. Open-sourced 2026 to share the cross-product webhook pattern.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FdapperAuteur%2Fwitus-inbox&env=NEXTAUTH_SECRET,EMAIL_SERVER,EMAIL_FROM,ADMIN_EMAIL,INGEST_SOURCES&envDescription=See%20.env.example%20for%20each%20variable%27s%20purpose%20and%20format.%20Generate%20NEXTAUTH_SECRET%20with%20%60openssl%20rand%20-base64%2032%60.%20Generate%20each%20INGEST_SOURCES%20hmac_secret%20with%20%60openssl%20rand%20-hex%2032%60.&envLink=https%3A%2F%2Fgithub.com%2FdapperAuteur%2Fwitus-inbox%2Fblob%2Fmain%2F.env.example&project-name=witus-inbox&repository-name=witus-inbox&demo-url=https%3A%2F%2Finbox.witus.online&demo-title=WitUS%20Inbox&demo-description=Cross-product%20signed-webhook%20triage)

The deploy button creates a Vercel project and a fork of this repo. After it deploys, add a Neon Postgres integration in the Vercel dashboard (Storage → Create → Neon → Production + Preview branches with `STORAGE_` env prefix), then run `npm run db:push` against each Neon branch to apply the schema. Full step-by-step in [`docs/deploy-vercel-neon.md`](./docs/deploy-vercel-neon.md).

---

## What it is

Each of your products (landing pages, course platforms, scheduling tools, contact forms) POSTs a signed JSON webhook to one URL. This receiver verifies the signature, persists the submission, and surfaces it in a triage dashboard where you read, status-track, and reply.

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
- **Tailwind v4** with `@headlessui/react`, `lucide-react`, and `class-variance-authority`
- **Drizzle ORM** with **Neon Postgres**
- **NextAuth v4** + EmailProvider via Mailgun SMTP (single-admin gate)
- **Mailgun HTTP API** for outbound replies
- **Mobile Text Alerts** for SMS on `priority=high` submissions (optional; falls back to dev-log when unset)

Every external dependency has a no-op / dev-log fallback, so you can run the receiver without any third-party credentials.

## Quick start

> Full deploy guide: [`docs/deploy-vercel-neon.md`](./docs/deploy-vercel-neon.md). Walks Vercel + Neon end-to-end with Production + Preview environments configured for PII safety.

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
- One `INGEST_SOURCES` entry per publisher product:
  ```
  INGEST_SOURCES=[{"slug":"my-landing-page","hmac_secret":"<openssl rand -hex 32>"}]
  ```

For real outbound email (sign-in magic links plus replies), you'll also need a Mailgun account with a verified sending domain. Without one, the `EmailProvider` will throw at sign-in and `lib/mailgun.ts` will dev-log replies instead of sending.

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

`X-Witus-Signature` is `HMAC-SHA256(secret, "${timestamp}.${rawBody}")`, hex-encoded. Replay window is 5 minutes, with constant-time comparison.

Full spec, payload Zod schema, failure modes, and a working curl example live in **[`docs/webhook-contract.md`](./docs/webhook-contract.md)**.

A working sender library lives at [`examples/sender.ts`](./examples/sender.ts). Copy-paste into your publisher product, or import from this repo. [`examples/README.md`](./examples/README.md) has integration patterns for Next.js Server Actions, Express, and other-language senders.

## Triage UI

`/inbox` lists submissions newest-first with source / form-type / status filters. `/inbox/[id]` opens a detail view: humanized payload, a status select (`new` → `in_progress` → `replied` → `waiting` → `closed`), and a reply composer that sends via Mailgun and threads outbound replies into a history list.

**Inbound reply threading** is wired. Each outbound reply is sent with a per-submission Reply-To address (`inbox+<submission-id>@<MAILGUN_DOMAIN>`); when the submitter replies, Mailgun's inbound route forwards the email to `/api/inbound-email`, which verifies the webhook signature and appends the message to the submission's history. Replied / closed submissions resurface to `in_progress` so they re-enter the triage queue. The Mailgun inbound route is a one-time operator setup; see [`docs/deploy-vercel-neon.md`](./docs/deploy-vercel-neon.md).

## Contributing

Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) before opening a PR. The webhook contract is stable on purpose; PRs that change it need a design issue first.

## Security

Found a vulnerability? See [`SECURITY.md`](./SECURITY.md). Don't open a public issue.

## License

[MIT](./LICENSE) © 2026 Brand Anthony McDonald
