<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# WitUS Inbox — agent instructions

**Read order before writing any code:**

1. [`./plans/ecosystem/README.md`](./plans/ecosystem/README.md) — ecosystem platform index + Redundancy Test
2. [`./plans/ecosystem/witus-inbox.md`](./plans/ecosystem/witus-inbox.md) — this product's one-job definition
3. [`./plans/00-descriptions.md`](./plans/00-descriptions.md) — non-negotiables, coding style, git workflow, verification checklist
4. Workflow descriptors: [`bugs/`](./plans/bugs/00-descriptions.md) · [`future/`](./plans/future/00-descriptions.md) · [`validate/`](./plans/validate/00-descriptions.md) · [`reports/`](./plans/reports/00-descriptions.md)
5. The specific `./plans/NN-*.md` plan you are executing.

**Hard rules (grep these in `./plans/00-descriptions.md`):**

- Mobile-first (360px viewport), ARIA-compliant, keyboard-reachable, focus rings visible.
- TypeScript strict. Server Components by default; `"use client"` only when needed.
- `ADMIN_EMAIL` middleware gate on every authed route. HMAC verification on `/api/ingest` (5-min timestamp skew, constant-time compare).
- Never log submission payloads, submitter emails, or secrets. Log `source`, `form_type`, `submission_id` only.
- `plans/` is gitignored. Planning docs never ship in a commit.
- Every plan ships on its own branch. **Never push to `main`** — the user reviews and pushes.

**If you are changing something the ecosystem docs call out as another platform's job: stop and ask.**
