# Deploy on Vercel + Neon

End-to-end recipe to get a working Inbox at `https://your-domain.example` with a Production + Preview environment, signed-webhook ingest, magic-link sign-in, and zero PII bleed between environments. ~30 minutes of Vercel/Neon clicks plus DNS.

This is the path the canonical deployment at [`inbox.witus.online`](https://inbox.witus.online) was built on. If you self-host on a different stack (Fly, Railway, your own Postgres + Mailgun replacements), the Vercel-specific steps swap out but the env-var contract is the same.

---

## Prerequisites

- Vercel account ([vercel.com/signup](https://vercel.com/signup), free tier works).
- A custom domain you can edit DNS for (e.g. `inbox.your-domain.example`). You can ship a working Inbox on the default `*.vercel.app` URL and add a custom domain later.
- A Mailgun account with a verified sending subdomain (e.g. `mg.your-domain.example`) for sign-in magic links + outbound replies. The free 100/day sandbox works for evaluation.
- A locally cloned copy of this repo + Node 24+.
- (Optional) A [Mobile Text Alerts](https://mobile-text-alerts.com) account for SMS on `priority=high` submissions.

---

## 1. Fork + clone

```bash
# Fork on GitHub (UI), then:
git clone https://github.com/<your-handle>/witus-inbox.git
cd witus-inbox
npm install
```

---

## 2. Create the Vercel project

```bash
# From the repo root:
npx vercel link
# Pick or create a Vercel project; let it detect Next.js.
```

Don't deploy yet — env vars need to land first.

---

## 3. Provision Neon (Production + Preview branches)

The Vercel + Neon Marketplace integration provisions a Postgres database and auto-injects connection-string env vars into your Vercel project.

1. **Vercel dashboard** → your project → **Storage** → **Create Database** → **Neon**.
2. Pick a region (US-East-1 is usually fine; pick closest to your Vercel functions region).
3. **Important configuration** for the integration:
   - **Production database branch**: `main` (default).
   - **Create database branch for deployment** = **Preview**.
   - **Preview branches: empty template, NOT clone of production.** This is the rule from the project's [non-negotiables](../plans/00-descriptions.md) §3 — preview must never carry real PII.
   - **Auto-delete preview branches after 7 days** (or 14 — Neon free tier caps branches at ~10).
   - **Custom env prefix** = `STORAGE_`. The receiver code reads `STORAGE_DATABASE_URL` and `STORAGE_DATABASE_URL_UNPOOLED`. If you skip the prefix, you'll need to rename the vars in your code.
4. Save. Vercel injects `STORAGE_DATABASE_URL`, `STORAGE_DATABASE_URL_UNPOOLED`, plus 13 alternative representations the code doesn't use.

### Apply the Drizzle schema to each branch

```bash
# Pull preview env locally so drizzle-kit can target the preview branch:
vercel env pull .env.preview.local --environment=preview
# Push the schema to the preview branch:
set -a; source .env.preview.local; set +a
npm run db:push     # drizzle-kit creates 7 tables + 4 enums
```

Repeat for production:

```bash
vercel env pull .env.production.local --environment=production
set -a; source .env.production.local; set +a
npm run db:push
```

Without this step, the first sign-in attempt will 500 (NextAuth's adapter `getUserByEmail` query fails on a missing `user` table).

---

## 4. Production environment variables

In Vercel → **Settings → Environment Variables → Production**, add:

| Var | Value | Notes |
|---|---|---|
| `NEXTAUTH_URL` | `https://your-domain.example` | Canonical URL with the domain you'll connect in step 7. No trailing slash. |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` | 32+ random bytes. Distinct from any other env. |
| `EMAIL_SERVER` | `smtp://postmaster@mg.your-domain.example:<password>@smtp.mailgun.org:587` | Mailgun SMTP creds. The username is the Mailgun "SMTP credentials" entry on your sending subdomain; the password is the secret Mailgun shows once at credential-creation. |
| `EMAIL_FROM` | `Inbox <inbox@your-domain.example>` | Header `From:` on outbound mail. The `mg.` subdomain handles delivery; the parent domain is what users see. |
| `ADMIN_EMAIL` | `you@your-domain.example` | The only address that can sign in. Magic links to other addresses get rejected by the auth callback. |
| `MAILGUN_API_KEY` | from Mailgun dashboard | Used by the reply composer for outbound mail via Mailgun's HTTP API. |
| `MAILGUN_DOMAIN` | `mg.your-domain.example` | Same subdomain as `EMAIL_SERVER`. |
| `BVC_SUBMISSIONS_EMAIL` | `submissions@your-domain.example` | DR archive address every publisher product also emails. Optional; defaults to a witus-specific address that you'll want to override. |
| `INGEST_SOURCES` | `[{"slug":"my-publisher","hmac_secret":"<openssl rand -hex 32>"}]` | One entry per publisher product. `hmac_secret` MUST be ≥32 chars. |
| `MOBILE_TEXT_ALERTS_API_KEY` | from MTA dashboard | Optional. Without it, `lib/sms.ts` falls back to dev-log. |
| `MOBILE_TEXT_ALERTS_RECIPIENTS` | `["+15551234567"]` | E.164 strings. Optional. |

---

## 5. Preview environment variables

**Critical for PII safety:** preview must not be able to send real email or SMS, and must use distinct secrets from production.

In Vercel → **Settings → Environment Variables → Preview**:

| Var | Value | Notes |
|---|---|---|
| `NEXTAUTH_URL` | _unset_ | Leave blank. NextAuth falls back to `VERCEL_URL` — the per-deploy preview URL — automatically. |
| `NEXTAUTH_SECRET` | a **separate** `openssl rand -base64 32` value | Don't share with prod. Distinct so preview JWTs don't ever validate against prod cookies. |
| `EMAIL_SERVER` | `smtp://nobody:none@localhost:25` | **Non-routable placeholder.** EmailProvider constructs OK; send attempts fail. Preview cannot accidentally email a real submitter. (Or use a Mailtrap / Ethereal capture SMTP if you want to inspect what would have sent.) |
| `EMAIL_FROM` | same string as Production is fine | Header value only; never actually sent in this env. |
| `ADMIN_EMAIL` | same as Production | Diverging weakens the gate. |
| `MAILGUN_API_KEY` | _unset_ | `lib/mailgun.ts` falls back to dev-log. |
| `MAILGUN_DOMAIN` | _unset_ | Same. |
| `INGEST_SOURCES` | a **separate** array with **separate** `hmac_secret` values | Per-environment secrets. Rotating prod never affects preview. |
| `MOBILE_TEXT_ALERTS_API_KEY` | _unset_ | `lib/sms.ts` falls back to dev-log. |
| `STORAGE_DATABASE_URL` / `_UNPOOLED` | injected by the Neon integration | Don't set manually. |

Also turn on **Vercel Preview Protection** (Project → Settings → Deployment Protection): preview deploys then require Vercel SSO or a password. Without this, anyone who guesses a `*.vercel.app` URL can hit your authed routes.

---

## 6. First deploy

```bash
git push origin main          # if your default branch ships to production
# or click "Deploy" in the Vercel dashboard.
```

Watch the build log. Common first-time failures:

| Failure | Fix |
|---|---|
| `Invalid environment variables: <FIELD>: ...` | Required env var missing in the environment Vercel is building for. Add it; Vercel auto-redeploys on env change. |
| `[adapter_error_getUserByEmail] Failed query: select … from "user"` (runtime, after build succeeds) | The Neon branch for that environment is empty. Run `npm run db:push` against it (step 3). |
| `Invalid login: 535 Authentication failed` (runtime, on sign-in) | `EMAIL_SERVER` password placeholder. Generate the real Mailgun SMTP credential and replace it. |

---

## 7. Custom domain (optional)

1. Vercel → your project → **Settings → Domains** → **Add** `inbox.your-domain.example`.
2. Vercel shows the CNAME / A record value. Add it at your DNS provider.
3. Wait for DNS propagation (a few minutes typically).
4. Update `NEXTAUTH_URL` in Production to `https://inbox.your-domain.example` if you didn't already.
5. **DKIM/SPF for Mailgun.** In your DNS provider, add the records Mailgun showed you when you set up `mg.your-domain.example` — typically one TXT for SPF (`v=spf1 include:mailgun.org ~all`) and one TXT for DKIM. If these aren't in place, magic-link emails will land in Spam (or be silently dropped) by Gmail/Outlook.

---

## 8. Wire your first publisher product

Server-side (in your publisher product's repo):

```ts
import { sendToInbox } from "./lib/inbox-sender"; // copy from witus-inbox/examples/sender.ts

await sendToInbox({
  inboxUrl:    process.env.INBOX_INGEST_URL!,    // https://inbox.your-domain.example/api/ingest
  sourceSlug:  process.env.INBOX_SOURCE_SLUG!,   // "my-publisher" — must match INGEST_SOURCES on the receiver
  hmacSecret:  process.env.INBOX_INGEST_SECRET!, // identical string to receiver's INGEST_SOURCES[i].hmac_secret
  submission:  {
    form_type: "contact",
    submitter_email: form.email,
    submitter_name: form.name,
    payload: form,
  },
});
```

The publisher's `INBOX_INGEST_SECRET` (per environment) MUST be identical to the receiver's matching `INGEST_SOURCES` entry's `hmac_secret`. See [`examples/README.md`](../examples/README.md) for Server Action / Express patterns.

---

## 9. Sanity check

From a fresh shell, against your live production URL:

```bash
SECRET="<the production hmac_secret for your slug>"
SOURCE="my-publisher"
INBOX="https://inbox.your-domain.example/api/ingest"

BODY='{"form_type":"smoke","submitter_email":"you@your-domain.example","priority":"normal","payload":{"hi":"there"}}'
TIMESTAMP=$(date +%s)
SIG=$(printf '%s.%s' "$TIMESTAMP" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')

curl -i -X POST "$INBOX" \
  -H "Content-Type: application/json" \
  -H "X-Witus-Source: $SOURCE" \
  -H "X-Witus-Timestamp: $TIMESTAMP" \
  -H "X-Witus-Signature: sha256=$SIG" \
  --data-raw "$BODY"
```

Expect `200 {"ok":true,"id":"<uuid>"}`. Then sign in at `https://inbox.your-domain.example/auth/sign-in`; the smoke-test row should appear in the inbox list.

---

## Recurring operations

- **Add a new publisher product:** add an entry to `INGEST_SOURCES` (per environment), distribute the matching secret to the publisher's env, redeploy.
- **Rotate an HMAC secret:** generate fresh, update **both** the receiver and the publisher in lockstep, redeploy both. After rotation, delete any stale preview Neon branches that may still hold the old secret — they'd accept old-signature replays until expiry.
- **Rotate `NEXTAUTH_SECRET`:** invalidates every active session in that environment. Pick a low-traffic window. Recommend every 90 days.
- **Deal with Spam-routing of sign-in emails:** mark the first one "Not spam" on each operator account. Subsequent magic links from the same sender + recipient pair land in Inbox.

---

## What this guide doesn't cover

- Self-hosting on Fly / Railway / Docker — the env-var contract carries over; the deploy mechanics swap out.
- Replacing Mailgun with Resend / Postmark / Amazon SES — `EMAIL_SERVER` accepts any SMTP URL; for the reply composer's HTTP API path, `lib/mailgun.ts` would need a sibling for the new provider.
- Replacing Neon with another Postgres — change `STORAGE_DATABASE_URL` to your provider's URL; `db:push` will run if the SQL surface is compatible. The receiver itself is plain Postgres + JSONB, no Neon-specific features.
- Multi-tenant setups — the receiver is single-operator by design. See [CONTRIBUTING.md](../CONTRIBUTING.md) for scope.
