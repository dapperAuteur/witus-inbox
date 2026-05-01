# Roadmap

Public roadmap for WitUS Inbox. The project is intentionally narrow (single-operator, signed-webhook triage). This doc declares what's in v0, what's planned for v1 and v2, and what's deliberately out of scope forever.

If a feature you want isn't listed and isn't in the "out of scope" section, it's a candidate for a discussion. If it's in "out of scope," it's not. Open a feature-request issue or a discussion before opening a PR.

---

## v0.1.0 — shipped (launch tag, 2026-06-15)

The single-operator triage layer with inbound reply threading. See [`CHANGELOG.md`](../CHANGELOG.md) for the full feature inventory at launch.

The contract surface is **stable from this version forward**. Breaking changes go through a 90-day deprecation window with a `X-Witus-Contract-Version` header opt-in.

---

## v1 — planned

Quality-of-life improvements that fit the single-operator scope. No timeline. Each item ships as its own PR; the v1 tag drops when enough has accumulated to be worth a release.

### Tags, search, saved filters

`/inbox` filter UI today: source + form_type + status. v1 adds:

- **Tags**: an arbitrary string label per submission. `lifetime-member-converted`, `cold-lead`, `responded-via-phone`, etc. Operator-defined. New `tag` table, M:N to submissions.
- **Full-text search** over `payload` (Postgres `tsvector` on the JSONB), submitter name/email, and reply bodies.
- **Saved filters**: name a filter URL ("hot leads this week"), pin to the inbox sidebar.

### Passkey auth (`@simplewebauthn`)

Magic-link email is fine but adds a step every session. WebAuthn / passkey gives single-tap sign-in on a phone. Single-admin model is unchanged; the gate is still `email === ADMIN_EMAIL` in `proxy.ts` plus the NextAuth callback.

### CSV export from the inbox

Today the canonical archive lives in Postgres + a Google Sheet (via Apps Script reading the DR archive Gmail). A direct `/inbox/export` endpoint that streams CSV with current filter applied removes the Sheet dependency for ad-hoc analysis.

### Per-submission attachments

The current contract treats `payload` as JSON-only; large/binary submissions don't fit. v1 adds optional `attachments` field accepting a list of presigned-URL or base64 chunks (decision pending), persisted to a separate `submission_attachment` table.

### Webhook contract `X-Witus-Contract-Version` header

Adds the header documented in [`docs/webhook-contract.md`](./webhook-contract.md#versioning). v0 senders that omit it are treated as v1; future v2 senders set it to `2`. Pure preparation work for the v2 deprecation window.

---

## v2 — likely, not committed

Bigger architectural moves. The v2 tag may not happen for a year or longer.

### Multi-user with per-source ACLs

Replace the single `ADMIN_EMAIL` gate with a `users` + `user_source_access` schema. Each user's session is scoped to a set of source slugs they can triage. The `signIn` callback in `lib/auth.ts` flips from a literal email match to a DB lookup.

This is the biggest user-visible change in the project's life and is genuinely v2-magnitude. Expect a design issue + RFC period before any code lands.

### Optional CC/BCC the DR archive on outbound replies

v0 stopped CC'ing the BVC archive when per-submission Reply-To shipped. Some operators may want belt-and-braces archival of every outbound reply. Optional flag, off by default.

### Retry queue on the sender side

Fire-and-forget is the v0 contract. v2 might add a documented pattern for wrapping `sendToInbox()` in BullMQ / Vercel Queues / etc. with a retry-and-dead-letter shape. The receiver itself doesn't need changes; this is mostly examples + docs.

### Webhook contract v2 (breaking)

If the contract has accumulated enough warts to justify breaking compatibility, v2 ships with the `X-Witus-Contract-Version: 2` header path. Candidates discussed (none committed):

- Asymmetric (Ed25519) signing for cases where publishers and receivers are operated by different parties.
- A `dedup_id` field for at-least-once delivery semantics.

Each breaking change goes through a contract-change issue first.

---

## Out of scope, indefinitely

Things this project will not become. If you want any of these, **fork**.

### A general-purpose webhook bus

Multi-tenant SaaS. Pricing tiers. Customer accounts. Webhook gateways across providers. There are paid products that do this well; the value of WitUS Inbox is *self-hosted, single-operator, narrow*. Adding tenancy collapses that into noise.

### Replacing default integrations as the default

You can add new optional integrations as opt-in modules (other email providers, other SMS providers, other DBs). Replacing Mailgun, Neon, or Mobile Text Alerts as the default ships as a fork, not a PR against this repo.

### A built-in CMS, dashboard editor, or low-code form builder

The Inbox triages forms; it doesn't build them. Forms are the publisher product's concern.

### Visualization / analytics dashboards

Charts, funnels, conversion-rate tracking. Useful, but a different product. The current stance: query Postgres directly or pipe to a tool that does this well (Metabase, Grafana, etc.).

### Inbound webhook authentication beyond HMAC-SHA256

A persistent request: "add JWT signing", "add API key + IP allowlist", "add OAuth client_credentials." Each of these is a different contract. The HMAC-SHA256 contract is enough for the single-operator-self-hosted use case the project targets. If you need something else, fork with your own header namespace.

---

## How decisions get made

- v0.x bug fixes and additive features: open an issue, ship a PR.
- v1.x scope additions: open an issue, expect discussion, then a PR.
- v2 / breaking changes / contract changes: open a *contract-change* issue (see `.github/ISSUE_TEMPLATE/contract-change.yml`), expect a discussion period, expect skepticism, ship the PR only after consensus.
- "Out of scope" items: fork. The project's narrowness is the feature.

The maintainer is single-operator (BAM). Response time on issues is best-effort; the [`SECURITY.md`](../SECURITY.md) timeline is the only one with an SLA.
