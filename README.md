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
- **Better Stack** error monitoring via the `@sentry/nextjs` SDK (optional; inert until a DSN is set)

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

## Sign in with WitUS (ecosystem SSO)

Alongside the magic-link form, `/auth/sign-in` offers **Sign in with WitUS** — the shared ecosystem IdP (`accounts.witus.online`) as a NextAuth OIDC provider. The admin gate is unchanged: whichever provider is used, `lib/auth.ts` still rejects any email that is not `ADMIN_EMAIL`.

**"Continue as &lt;name&gt;" is deliberately OFF on this app.** `WITUS_SHOW_CONTINUE_AS = false` in [`lib/env.ts`](./lib/env.ts). Inbox is admin-gated, `/auth/sign-in` is publicly reachable, and the app cannot know who the browser is until the OIDC flow has already run. The probe answers *"there is a WitUS session, and it belongs to Jane"* — it **cannot** answer *"Jane may sign in here"*, and it must never be asked to, because that answer crosses an origin boundary and gating access on it would be a security bug. So the honest option is not "probe and filter", it is **don't probe**: a personalized invitation to a door that gets slammed is worse than a plain door. Everyone sees the ordinary "Sign in with WitUS" button, and a non-admin who clicks it is routed to `/auth/waitlist` (below) instead of a raw NextAuth error page. **This is an opt-out, not a deletion** — the probe, its helpers, and their tests stay in place as the shared ecosystem implementation for the open apps, which pass `showContinueAs` (default `true`).

For reference, the mechanism those apps get: the sign-in form renders immediately and *in parallel* the page asks `<idp-origin>/api/ecosystem/session` (derived from `WITUS_OIDC_DISCOVERY_URL`, never hardcoded a second time) who this browser is; if an answer arrives within 4s the button relabels. The IdP cookie is third-party there, so Safari ITP and Firefox Total Cookie Protection answer nothing — a failed, blocked, or timed-out probe is completely invisible. **The name is display copy, never a credential**: clicking still runs the real OIDC code flow. A one-shot marker (`sessionStorage` `witus.sso.attempted`, plus a `?sso=tried` query param) is written *before* the redirect so a stale IdP session cannot produce a sign-in loop.

One behaviour **does** sit on top of the provider here, and it stays completely dark unless `WITUS_OIDC_CLIENT_ID` is set — the button does not render, nothing is requested from the IdP, and sign-out stays local:

- **Global sign-out** — the sign-out control in the `/inbox` header reads "Sign out of WitUS" when ecosystem SSO is configured, and signing out ends the shared session at the IdP too. The local NextAuth session is destroyed **first**, then the browser is handed off to the IdP's `end_session_endpoint`; if the IdP is unreachable or refuses, you are still signed out here. `post_logout_redirect_uri` is this app's origin **with a trailing slash** — that exact string must be registered for this client in the IdP registry (`gemini/witus` `lib/identity/clients.ts`) or the IdP returns `invalid_request`.

Env vars: `WITUS_OIDC_CLIENT_ID`, `WITUS_OIDC_CLIENT_SECRET`, optional `WITUS_OIDC_DISCOVERY_URL` (see [`.env.example`](./.env.example)). Design notes live in [`lib/silent-sso.ts`](./lib/silent-sso.ts); [`lib/silent-sso.test.ts`](./lib/silent-sso.test.ts) pins the gate, the sign-out ordering, the loop guard, the invisible-failure rule, and the admin-gated opt-out.

### A refused sign-in goes to `/auth/waitlist`, not a wall

`lib/auth.ts` sets `pages.error = "/auth/sign-in"`, so a failed sign-in comes back to this app instead of NextAuth's raw `/api/auth/error` page — which offers no message, no link back, and no route to anything.

`pages.error` is **one URL for every code that reaches it**, so the sign-in page reads `?error=` and branches ([`lib/auth-error.ts`](./lib/auth-error.ts)):

| `?error=` | What happens |
| --- | --- |
| `AccessDenied` — the admin gate refused this account | redirect to `/auth/waitlist?from=sso`: "That account doesn't have access here… want to be added to the list?" |
| `Verification` — an expired or already-used magic link | inline notice, "we'll send a fresh one", email form untouched |
| `Configuration`, `EmailSignin`, `OAuth*`, `SessionRequired`, anything unknown | inline notice saying what happened, with the email form still available |

That branching is **mandatory, not a nicety**: in the installed next-auth v4 (`core/index.js`, `case "error"`), both `AccessDenied` and `Verification` land on `pages.error`. Routing the whole page to the waitlist would tell an admin whose link merely expired that they have no access. [`lib/auth-error.test.ts`](./lib/auth-error.test.ts) pins the mapping.

**The waitlist records something real, and it is not a second mechanism.** This app has no waitlist table — what it has is the submissions pipeline it exists to serve. `POST /api/waitlist` writes a row into the `submission` table (`source: witus-inbox`, `form_type: waitlist-signup`, `received_via: manual`) that shows up in the normal `/inbox` triage queue with the normal status/reply tooling. It is idempotent on the address, so a repeat submission is not another row. It does **not** go through `/api/ingest` — that is the HMAC door for *other* origins, and this app would be signing a payload to itself; and it deliberately does not fire the triage-agent webhook, because an access request wants a human. The page asks for the address because NextAuth hands an error page a *code*, never the address that was refused.

## Health check

`GET /api/health` is the endpoint to point an uptime monitor at (Better Stack, or anything else). Point the monitor here rather than at the homepage: the homepage can answer 200 from cache while the database is down, so a green check there proves nothing.

The route runs a real `select 1` against Neon on every request, with a 4-second budget so a hung database fails fast instead of stalling the monitor.

- Healthy → **200** `{"ok":true,"service":"witus-inbox","checkedAt":"<ISO timestamp>"}`
- Database unreachable, erroring, or slower than 4s → **503** `{"ok":false,"error":"database_unreachable"}`

It is public and unauthenticated on purpose: no ingest HMAC signature, no admin session, and it is outside the [`proxy.ts`](./proxy.ts) matcher. So it is built to leak nothing.

- The 503 body is a **fixed token**. The caught error is never echoed, because a connection failure routinely carries the connection string, which carries the password. Only the error's class name reaches the server log.
- It returns **no submission data of any kind**: no counts, no latest-item info, nothing implying volume or content. This app holds other apps' names, emails, and free text.
- It is never cached: `dynamic = "force-dynamic"` plus `Cache-Control: no-store`.

[`__tests__/health.test.ts`](./__tests__/health.test.ts) asserts the healthy shape, the no-store header, the 503 token, and that a credential-bearing error string cannot reach the response body.

## Error monitoring

Crash reporting is wired through the `@sentry/nextjs` SDK, pointed at **Better Stack** (Better Stack ingests the Sentry protocol, so the DSN is whatever Better Stack issues for the source). It is **off until a DSN exists**: with `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` unset, `Sentry.init()` never runs, no network call is made, and the build behaves exactly as before. Tracing and session replay are hard-coded to a 0 sample rate: this app displays other people's submissions, so replaying an operator's screen is not something to ship offsite.

Because every request here carries a signature over someone else's data, a `beforeSend` scrubber in [`lib/sentry-scrub.ts`](./lib/sentry-scrub.ts) runs before anything leaves the process. It deletes the request body outright, drops any header whose name looks like a signature / secret / token / key / auth / cookie, removes user email + IP + username, and redacts token-bearing URLs, emails, JWTs, long hex digests (an HMAC signature or an `openssl rand -hex 32` secret) and labelled secrets from every remaining string. [`lib/sentry-scrub.test.ts`](./lib/sentry-scrub.test.ts) asserts the *serialized* event carries none of them.

Env vars are documented in [`.env.example`](./.env.example) under "Error monitoring". Source-map upload happens at build time only when `SENTRY_ORG`, `SENTRY_PROJECT`, and `SENTRY_AUTH_TOKEN` are all present; without them the build succeeds and stack traces are just minified.

## Distributed tracing

Traces go to **Honeycomb** over OTLP via `@vercel/otel` ([`otel.config.ts`](./otel.config.ts),
registered from [`instrumentation.ts`](./instrumentation.ts) **before** the Sentry configs load —
whoever registers the global tracer provider first wins, and Sentry is told to stand down via
`skipOpenTelemetrySetup` in `sentry.server.config.ts`). Service name is `witus-inbox`.

- **Inert until the key is set**: `HONEYCOMB_INGEST_API_KEY_SECRET` (fallback `HONEYCOMB_API_KEY`).
  Same inert-until-provisioned pattern as the Sentry DSN — with neither var set, registration is
  skipped entirely.
- **`/api/health` spans are dropped at the sampler** — uptime monitors probe it around the clock,
  and those requests must not spend Honeycomb's free-tier event budget. Everything else is recorded
  unsampled.
- **This app is the middle of the cross-app trace.** `@vercel/otel` honors incoming W3C
  `traceparent` headers, so a span started by a sending app (bam-landing-page, shop-witus, …)
  continues here as the same trace. `/api/ingest` additionally **persists the sender's
  `traceparent` + `tracestate` with the submission** (columns in [`db/schema.ts`](./db/schema.ts))
  and **forwards them in the triage-agent start webhook**, so the *async* hop — submission now,
  triage run later — continues the same distributed trace. One waterfall from a form submit on the
  sending site to the triage agent's LLM calls.

## E2E + accessibility CI

Playwright specs live in [`e2e/`](./e2e/); the gate runs in
[`.github/workflows/e2e.yml`](./.github/workflows/e2e.yml) on `deployment_status` — it tests the
**real Vercel deployment URL** (preview → full suite, production → `@smoke` only), so CI needs no
secrets, database, or env. The suite runs desktop plus a 360px mobile project, and every covered
page must pass an axe check with **zero serious or critical WCAG A/AA violations** — the gate is
strict on purpose; fix the page, not the gate.

- Local runs: `PLAYWRIGHT_BASE_URL=<url> npx playwright test` (drives installed Chrome via
  `channel: "chrome"`; Playwright's bundled chromium doesn't support macOS 13).
- If the Vercel project enables Deployment Protection, set the project's "Protection Bypass for
  Automation" secret as the `VERCEL_AUTOMATION_BYPASS_SECRET` Actions secret; public previews need
  nothing.
- **Synthetic traffic is tagged, not hidden**: every request the suite makes carries
  `x-witus-origin-test: playwright-synthetic`, which the OTel layer surfaces as the
  `witus.origin_test` span attribute — Honeycomb queries (and logs/analytics) can include or
  exclude test traffic. Absent header = attribute absent = real user.

## Tutorial pipeline

Tutorials are **recorded as Playwright specs** in [`e2e/tutorials/`](./e2e/tutorials/)
(`*.tutorial.ts`, harness contract in [`e2e/tutorials/tutorial.ts`](./e2e/tutorials/tutorial.ts)) —
a tutorial that no longer passes is a tutorial that no longer matches the product. Three npm
scripts drive it:

| Script | Does |
|---|---|
| `npm run tutorial:record` | Runs the tutorial specs under `playwright.tutorial.config.ts` (one worker, slowMo, 1280×720, video on) |
| `npm run tutorial:docs` | Generates step-by-step markdown docs from the recorded steps |
| `npm run tutorial:video` | Composes the narrated video from the recording |

- `TUTORIAL_STORAGE_STATE` points at a signed-in Playwright storage state (this repo's `/inbox`
  surfaces are gated to `ADMIN_EMAIL`, so it must be the admin session; `.auth/` is gitignored —
  never commit a session). Auth-requiring tutorials *skip* (not fail) without it.
- `TUTORIAL_SUBMITTER` names the test account so row-matching targets the tutorial's own
  submission; `TUTORIAL_SEND_REPLY=1` gates the one mutating click (actually sending a reply).
- Recording sessions carry the same `x-witus-origin-test: playwright-synthetic` tag as the CI
  suite (tag, not a drop: traces still flow).
- Generated docs are committed under `docs/tutorials/`; recorded videos and intermediates
  (`tutorial-output/`, `docs/tutorials/video/`) are gitignored.

## Contributing

Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) before opening a PR. The webhook contract is stable on purpose; PRs that change it need a design issue first.

## Security

Found a vulnerability? See [`SECURITY.md`](./SECURITY.md). Don't open a public issue.

## Roadmap and changelog

Public roadmap at [`docs/roadmap.md`](./docs/roadmap.md). Notable changes per release at [`CHANGELOG.md`](./CHANGELOG.md).

## License

[MIT](./LICENSE) © 2026 Brand Anthony McDonald
