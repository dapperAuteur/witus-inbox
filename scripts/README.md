# Inbox scripts

| Script | Purpose |
|---|---|
| `smoke-test-bam-landing-page.ts` | Validates the `bam-landing-page` source slug + `hmac_secret` are correctly configured in `INGEST_SOURCES`. Runs against `INBOX_URL` (defaults to local dev `http://localhost:3000/api/ingest`). PASS = receiver returned 2xx; FAIL prints the failure mode. Auto-loads `.env.local` via dotenv. |

## Usage

```sh
# Local dev (default)
npm run dev                     # in one terminal
npm run smoke:bam-landing-page  # in another

# Against a deployed Inbox (e.g. preview)
INBOX_URL=https://your-preview.vercel.app/api/ingest \
  npm run smoke:bam-landing-page
```

Expect `PASS — 200 {"ok":true,"id":"<uuid>"}`. Then check the triage UI or the `submission` table to confirm the row landed with `source=bam-landing-page` and `form_type=hire`.

## Pre-req

`INGEST_SOURCES` (in `.env.local` for local runs, or in the Vercel env for the deployed Inbox) must contain a `bam-landing-page` entry whose `hmac_secret` matches what the bam-landing-page sender uses:

```
INGEST_SOURCES=[{"slug":"bam-landing-page","hmac_secret":"<shared-secret>"}, ...]
```

If the slug is missing, the script names that as the failure mode.
