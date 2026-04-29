# Contributing to WitUS Inbox

Thanks for considering a contribution. This is a single-operator tool, open-sourced for reuse, and its scope is intentionally narrow. Reading this file before opening a PR will save us both time.

## Scope

In scope:

- Bug fixes anywhere in the receiver, triage UI, or contract verification.
- Compatibility fixes for new versions of Next.js, NextAuth, Drizzle, Neon's serverless driver, Mailgun, etc.
- New optional integrations (other email providers, other SMS providers, other DBs) **as opt-in modules**, not replacements for the defaults.
- Documentation: deploy guides for non-Vercel hosts, examples of publisher senders in other languages.
- Accessibility, performance, and a11y/i18n fixes to the triage UI.

Out of scope (please open a discussion first):

- Multi-tenant mode. The tool is single-operator on purpose.
- Any change to the **signed-webhook contract** (headers, signing algorithm, replay window, payload shape). The contract is the project's stable surface, and publisher products plus forks depend on it not moving. Open a design issue first; expect skepticism.
- Replacing one of the default integrations (Mailgun, Mailgun SMTP, Neon, Mobile Text Alerts) with a different default.
- "Big rewrite" PRs. Small, atomic changes get reviewed; large ones tend to bit-rot.

## Local dev setup

```bash
git clone https://github.com/dapperAuteur/witus-inbox.git
cd witus-inbox
cp .env.example .env.local
# Fill in:
#   STORAGE_DATABASE_URL          (Neon pooled connection string)
#   STORAGE_DATABASE_URL_UNPOOLED (Neon direct, for migrations)
#   ADMIN_EMAIL                   (the only address that can sign in)
#   NEXTAUTH_SECRET               (`openssl rand -base64 32`)
#   NEXTAUTH_URL                  (http://localhost:3000 for local dev)
#   EMAIL_SERVER + EMAIL_FROM     (Mailgun SMTP creds, or omit for dev-log)
#   INGEST_SOURCES                (one entry per publisher; secrets >= 32 chars)

npm install
npm run db:push       # apply schema to your Neon branch
npm run dev           # http://localhost:3000
```

Sign in with `ADMIN_EMAIL`. The magic-link email goes through Mailgun SMTP if configured, or falls back to a dev log if `EMAIL_SERVER` is unset (set `EMAIL_SERVER=smtp://nobody:none@localhost:25` to satisfy the Zod schema without sending real mail).

## Smoke-testing the webhook contract

```bash
# In one terminal
npm run dev

# In another, after adding a "smoke" entry to INGEST_SOURCES
npm run smoke:bam-landing-page
```

Expect `PASS: 200 {"ok":true,"id":"<uuid>"}`. The reference sender library lives at [`examples/sender.ts`](./examples/sender.ts), with integration patterns in [`examples/README.md`](./examples/README.md). The script at [`scripts/smoke-test-bam-landing-page.ts`](./scripts/smoke-test-bam-landing-page.ts) is a thin wrapper around it for end-to-end verification.

## Branching and PRs

- Branch off `main`. Naming: `feat/<slug>`, `fix/<slug>`, `docs/<slug>`, `chore/<slug>`.
- One concern per PR. Multiple commits OK; mixing concerns is not.
- Each commit must pass `npm run build`.
- Use the PR template (added at launch) and link to any related issue.
- Before pushing, run:
  ```bash
  npx tsc --noEmit
  npm run build
  ```

## Style

- TypeScript strict; no `any` without a `// reason:` comment.
- Server Components by default; `"use client"` only where it earns its place.
- Tailwind v4 utility classes; avoid inline `style=` for non-dynamic values.
- Mobile-first (360px), keyboard-reachable, visible focus rings.
- DB writes that touch PII-bearing columns (`submission.submitter_email`, `submission.payload`, `reply.body`) **must be wrapped in try/catch** and only log error class names, not query params. Drizzle's default error shape leaks parameters; never let it reach `console.error` directly.
- Log `source`, `form_type`, and `submission_id` only. Never log `payload_json` content, submitter email, or recipient phone numbers.

## Reporting bugs

Open a GitHub issue with: a minimal reproduction, the version (commit SHA) you're on, what you expected, what you got, and any relevant log lines (with secrets redacted).

For security vulnerabilities: do **not** open a public issue. See [`SECURITY.md`](./SECURITY.md).

## License of contributions

By contributing, you agree your work is licensed under the same [MIT License](./LICENSE) as the project.
