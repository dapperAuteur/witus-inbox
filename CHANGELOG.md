# Changelog

Notable user-facing and contract-affecting changes. Format inspired by [Keep a Changelog](https://keepachangelog.com); versions follow [Semantic Versioning](https://semver.org).

## [Unreleased]

Track E open-source launch prep. Final cut of v0.1.0 happens at the launch tag.

### Added

- Issue templates (bug, feature, contract-change), PR template, GitHub Actions CI.
- Unit tests for `lib/hmac.ts` and `lib/mailgun-webhook.ts` via vitest.
- Public roadmap at [`docs/roadmap.md`](./docs/roadmap.md).

### Changed

- `lib/mailgun.ts` and `lib/sms.ts` no longer fall back to dev-log when `VERCEL_ENV === "production"` and credentials are missing. They return `{ ok: false }` with a sanitized log line, so misconfigured production deploys surface a 502 in the UI instead of a false "Replied" state.

## [0.1.0] — 2026-06-15 (planned, OSS launch)

The first publicly tagged release. Surface as of launch day.

### Receiver

- `POST /api/ingest`: signed-webhook receiver. Verifies HMAC-SHA256 over `${timestamp}.${rawBody}` with a 5-minute replay window and constant-time compare. Per-source `hmac_secret` floor of 32 chars enforced via Zod. Inserts a `submission` row, fires SMS on `priority=high` (Mobile Text Alerts).
- `POST /api/inbound-email`: Mailgun inbound-route receiver. Verifies Mailgun's webhook signature. Extracts the submission UUID from the per-submission Reply-To subaddress (`inbox+<uuid>@<MAILGUN_DOMAIN>`). Inserts an inbound `reply` row and resurfaces the submission to `in_progress` when it had been `replied` or `closed`.
- `POST /api/submissions/[id]/reply`: composer-side outbound. Sends via Mailgun's HTTP API with a per-submission Reply-To.
- `POST /api/submissions/[id]/status`: triage-state transitions.

### Triage UI

- `/auth/sign-in` magic-link sign-in via NextAuth EmailProvider over Mailgun SMTP.
- `/inbox` newest-first list with source / form-type / status filters.
- `/inbox/[id]` payload renderer + status select + reply composer + history (outbound + inbound).
- Single-admin `ADMIN_EMAIL` gate enforced in middleware (`proxy.ts`) AND in the NextAuth `signIn` callback (defense-in-depth).
- Mobile-first at 360px, ARIA-compliant, keyboard-reachable.

### Contract

- Headers: `X-Witus-Source`, `X-Witus-Timestamp`, `X-Witus-Signature: sha256=<hex>`.
- Payload: Zod-validated (`form_type`, `submitter_email?`, `submitter_name?`, `priority?`, `payload`).
- Failure modes: 401 on auth issues, 400 on schema, 500 on DB error. Body always `{"ok":false}` with no diagnostic detail.
- Versioning: v0.1.0 is wire-compatible with the eventual v1; breaking changes go through a 90-day deprecation window.

### Documentation

- `README.md`, `LICENSE` (MIT), `CONTRIBUTING.md`, `SECURITY.md`.
- `docs/webhook-contract.md`: full contract spec with curl example.
- `docs/deploy-vercel-neon.md`: end-to-end Vercel + Neon deploy recipe.
- `docs/roadmap.md`: v0 / v1 / v2 scope.
- `examples/sender.ts`: ~75-line dependency-free TypeScript reference sender.
- `examples/README.md`: integration patterns (Next.js Server Action, Express, other-language).

### Known limitations (v0)

- Single-admin only. Multi-user with per-source ACLs is v2 scope.
- No retry queue on the sender side. Fire-and-forget by design; use a queue if you need durable delivery.
- No automated bounce handling beyond Mailgun's defaults.
- Sender-product wiring backlog has 19 known forms across 10 hosts; only `bam-landing-page` is wired at launch.

### Internals

- Next.js 16 App Router, TypeScript strict, React 19.
- Drizzle ORM with Neon Postgres (pooled for runtime, unpooled for DDL).
- Tailwind v4, `@headlessui/react`, `lucide-react`, `class-variance-authority`.
- NextAuth v4 with EmailProvider via Mailgun SMTP, JWT sessions.
- Vitest for security-path unit tests.

[unreleased]: https://github.com/dapperAuteur/witus-inbox/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/dapperAuteur/witus-inbox/releases/tag/v0.1.0
