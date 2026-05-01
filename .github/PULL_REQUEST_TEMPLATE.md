<!--
Thanks for sending a PR. A few rules from CONTRIBUTING.md before this gets reviewed:

- One concern per PR. If your branch mixes a bug fix and a refactor, split it.
- Branch name follows feat/<slug>, fix/<slug>, docs/<slug>, chore/<slug>.
- Each commit must pass `npm run build` on its own.
- If this PR changes the signed-webhook contract (headers, payload, signing algorithm, replay window), CLOSE THIS PR and open a "Webhook contract change proposal" issue first.
-->

## Summary

<!-- One paragraph: what changes and why. Past tense, observable user impact. -->

## Linked issue

<!-- "Closes #N" or "Refs #N". A bare PR with no issue is fine for typo / minor doc fixes; otherwise link an issue. -->

## Type

- [ ] Bug fix (non-breaking)
- [ ] New feature (non-breaking, additive only)
- [ ] Documentation
- [ ] Test or tooling
- [ ] Refactor (no behavior change)
- [ ] Breaking change — please explain in the Notes section
- [ ] Webhook contract change — STOP, see header

## Test plan

<!-- How a reviewer would verify this works. Bullet list of commands to run + expected outputs. Include negative cases when relevant (what shouldn't happen). -->

- [ ] `npx tsc --noEmit` clean.
- [ ] `npm run build` clean.
- [ ] (if applicable) `npm test` clean.
- [ ] Manual verification: …

## Plans / 00-descriptions §3 checklist

For changes touching the receiver, auth surface, or any code that reads or writes `submission.payload`, `submission.submitter_email`, or `reply.body`:

- [ ] No PII (submitter email, payload contents, recipient phone numbers) added to any log line. Only `source`, `form_type`, `submission_id` are loggable.
- [ ] DB writes that touch PII-bearing columns are wrapped in try/catch; the catch logs only the error class name (not the Drizzle params).
- [ ] If a new env var was added, it's optional in `lib/env.ts` unless it's truly required for the build to succeed.
- [ ] `.env.example` updated.

## Notes

<!-- Anything else a reviewer should know. Surprises during implementation, things you considered and rejected, follow-ups you'll file separately. -->
