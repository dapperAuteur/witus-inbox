---
app: witus-inbox
name: WitUS Inbox
stage: live
url: https://inbox.witus.online
updated: 2026-10-30
---

# Roadmap

WitUS Inbox is deliberately narrow: one operator triaging signed webhook form submissions from every WitUS app. This file is read by the witus.online admin roadmap page, so it keeps the shared five-section format. What is out of scope, and how decisions get made, follow the five sections.

## Live now
- Signed webhook receiver (`POST /api/ingest`): HMAC-SHA256 over timestamp and body, 5-minute replay window, one secret per sending app
- Text message to the operator on high-priority submissions (Mobile Text Alerts)
- Owner-only sign-in: magic link by email, or Sign in with WitUS linked to the same account
- Sign out of this app only, or of WitUS everywhere
- Refused sign-ins land on a waitlist form instead of a dead end
- Inbox list: 50 per page, five sorts, quick-filter chips with counts (kinds, one per app, High priority, Unread or new, Archived), search, received-date range, all in the URL
- CSV export of exactly the current view
- Archive and unarchive, one at a time or in bulk; a reply from the submitter brings an archived thread back
- Detail page: readable payload, status (new, in progress, replied, waiting, closed), reply composer sending through Mailgun
- Inbound reply threading: submitter replies land in the history and reopen replied or closed items
- Hand-off of new submissions to the WitUS Triage Agent when its URL and secret are set
- Health check at `/api/health` with a real database query
- Error monitoring with a scrubber that strips bodies, signatures, secrets and emails before anything leaves
- Anonymous product analytics (PostHog, no identify, no replay) and distributed tracing (OpenTelemetry)
- E2E and accessibility checks in CI; tutorial recording pipeline

## In progress
- Close and delete messages: Close and Reopen buttons, closed items hidden from the default list, permanent Delete with a confirm page, on the detail page and in bulk (task 29)

## Next
- Generated Drizzle migrations with a baseline, then a migrate-on-merge workflow (witus post-deploy backlog P3)
- `X-Witus-Contract-Version` header on the webhook contract, ahead of any contract v2
- Tags on submissions, operator-defined

## Backlog
- Saved filters pinned to the list
- Postgres full-text search over the payload and reply bodies
- Passkey sign-in
- Attachments on submissions
- Multi-user with per-app access (v2, needs a design issue first)
- Optional copy of outbound replies to the archive mailbox (v2)
- Documented sender-side retry queue pattern (v2)
- Webhook contract v2: asymmetric signing, dedup id (v2, contract-change issue first)

## Blocked on
- Close and delete reaching production: merge of the bundle (task 29)
- Confirming the high-priority text message arrives in production (task 25)
- Triage Agent hand-off: its URL and secret set in Vercel (task 13)
- Abuse control for the public waitlist route (task 22)

## Out of scope
- A general-purpose, multi-tenant webhook bus; fork for that
- Replacing Mailgun, Neon or Mobile Text Alerts as the defaults (optional modules are fine)
- A form builder, CMS or dashboard editor
- Analytics dashboards; query Postgres or use Metabase or Grafana
- Inbound authentication other than HMAC-SHA256

## How decisions get made
- Bug fixes and additive features: open an issue, ship a PR
- New v1 scope: open an issue, discuss, then a PR
- Breaking or contract changes: a contract-change issue and a discussion period first
- The maintainer is one person (BAM); only `SECURITY.md` has a response-time promise
