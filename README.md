# WitUS Inbox

Cross-product submission triage + reply surface for the WitUS ecosystem.

One job: ingest signed webhooks from every ecosystem product, store canonical records, let BAM read and reply from one dashboard. Not a per-product admin.

See [`./plans/ecosystem/witus-inbox.md`](./plans/ecosystem/witus-inbox.md) for the full one-job definition and [`./plans/00-descriptions.md`](./plans/00-descriptions.md) for the non-negotiables and contributor guide.

## Stack

- Next.js 16 App Router, TypeScript strict, React 19
- Tailwind v4 + `@headlessui/react` + `lucide-react` + `class-variance-authority`
- Drizzle ORM + Neon Postgres
- NextAuth v4 + EmailProvider via Mailgun SMTP
- Mailgun HTTP API (reply sending)
- Mobile Text Alerts (SMS on high-priority submissions)

## Local dev

```bash
cp .env.example .env.local   # fill in values
npm install
npm run db:push              # apply schema to your Neon branch
npm run dev                  # http://localhost:3000
```

Sign in with `ADMIN_EMAIL`; magic link is emailed via Mailgun SMTP.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` | Generate migration from schema diff |
| `npm run db:migrate` | Apply migrations |
| `npm run db:push` | Push schema directly (dev only) |
| `npm run db:studio` | Browse the DB |
