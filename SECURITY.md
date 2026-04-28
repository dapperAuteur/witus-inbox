# Security Policy

## Reporting a vulnerability

Email **a@awews.com** with the subject line `[witus-inbox security]`.

Please include:

- A description of the issue.
- Steps to reproduce, or a proof-of-concept.
- The commit SHA or release version you tested against.
- Your assessment of the impact (CVSS-ish: confidentiality / integrity / availability).
- Whether you'd like credit in the eventual disclosure (default: yes).

Please **do not** open a public GitHub issue, post to a Discussion, or share details on social media until a fix has shipped.

## Response time

This is a single-maintainer project. Expect:

- **Acknowledgment** within 72 hours.
- **Initial triage + impact assessment** within 7 days.
- **Fix or mitigation timeline** communicated within 14 days.
- **Public disclosure** coordinated with you, typically 30–90 days after a fix ships in the default branch.

If you don't hear back within 7 days, follow up on the same email thread — the original message may have been filtered.

## Scope

In scope:

- The receiver code (`/api/ingest`), the auth surface (`/api/auth/*`, `/inbox/*`), and the reply / status routes (`/api/submissions/[id]/*`).
- HMAC verification, replay-window logic, session handling, ADMIN_EMAIL gate.
- Anything in this repository that runs at request time.
- Any documentation that, if followed literally, would lead an operator into an insecure configuration.

Out of scope:

- Vulnerabilities in upstream dependencies (Next.js, NextAuth, Drizzle, Neon's serverless driver, Mailgun, etc.) — please report those upstream.
- Self-hosted misconfiguration where the operator has bypassed the documented setup (e.g., committed `.env.local` to a public repo, used a hand-typed `hmac_secret` shorter than the receiver enforces).
- Best-practice nitpicks without a concrete attack path.

## Supported versions

Until v1.0, only the latest commit on `main` is supported. After v1.0, the latest released minor will receive security fixes; older versions will not be back-patched unless the maintainer opts in.

## Hall of fame

Reporters who have helped harden the project will be listed here after their disclosures ship (with permission).

_(empty for now — be the first.)_
