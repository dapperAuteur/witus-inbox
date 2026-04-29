# Signed-webhook contract

This is the stable surface every publisher product writes to. The receiver's job is to verify the signature, validate the payload shape, and persist the submission. Nothing about this contract changes without a major-version bump.

> **Stability:** v0. Treated as v1 for compatibility purposes; breaking changes will go through a deprecation window.

## At a glance

```http
POST /api/ingest HTTP/1.1
Host: inbox.your-domain.example
Content-Type: application/json
X-Witus-Source:    your-publisher-slug
X-Witus-Timestamp: 1761234567
X-Witus-Signature: sha256=2b1c…d4f0

{
  "form_type": "contact",
  "submitter_email": "alice@example.com",
  "submitter_name": "Alice Cooper",
  "priority": "normal",
  "payload": {
    "anything": "the publisher wants to record"
  }
}
```

## Headers

| Header | Required | Format | Notes |
|---|---|---|---|
| `Content-Type` | yes | `application/json` | The body **MUST** be raw JSON; the receiver hashes the raw bytes. Form-urlencoded or multipart will fail signature verification even if the JSON shape is otherwise correct. |
| `X-Witus-Source` | yes | lowercase kebab string | The publisher's source slug. Must match an entry in the receiver's `INGEST_SOURCES`. Convention: one slug per publishing host (`witus-online`, `bam-landing-page`, etc.). |
| `X-Witus-Timestamp` | yes | unix seconds (integer string) | Used in the signature input and the replay-window check. |
| `X-Witus-Signature` | yes | `sha256=<hex>` (64 hex chars after the prefix) | HMAC-SHA256, see below. The `sha256=` prefix is canonical; the receiver also accepts the bare hex form for compatibility. |

Any of: missing header, malformed timestamp, slug not in `INGEST_SOURCES`, signature mismatch, or timestamp older than 5 minutes returns **HTTP 401, body `{"ok":false}`**. The receiver does not distinguish failure modes in the response (no leakage); look at the receiver's server logs for the specific `[ingest]` log line.

## Payload (Zod schema)

```ts
{
  form_type:        string (1..120 chars, required)
  submitter_email?: string, valid email (≤255 chars, optional)
  submitter_name?:  string (1..255 chars, optional)
  priority?:        "normal" | "high"   (default "normal")
  payload:          Record<string, unknown>   // arbitrary JSON object, required
}
```

Field-by-field:

- **`form_type`**: kebab, domain-descriptive identifier for *which* form on the publisher fired (`bvc-pilot-signup`, `coaching-intake`, `class-corvids`). Stable across versions of the publisher's UI; new versions of the same form should keep the same `form_type`.
- **`submitter_email` / `submitter_name`**: optional because some forms don't collect them (for example, a "give us a link to your work" survey). When present, the receiver renders them in the triage UI and uses `submitter_email` as the recipient when an admin replies.
- **`priority`**: `"high"` triggers the SMS alert path (`MOBILE_TEXT_ALERTS_API_KEY`), if configured. Use `"high"` for inbound that could be a paying customer today. Use `"normal"` for everything else; the dashboard already shows new rows.
- **`payload`**: the raw form fields. The receiver stores this as JSONB, so keep keys snake_case for readability in the triage UI's auto-generated label rows. Nested objects and arrays render as collapsed JSON.

Schema-invalid bodies (missing `form_type`, wrong type for a field, etc.) return **HTTP 400, body `{"ok":false}`**.

## Signing algorithm

```
signature = HMAC_SHA256(
  key  = <hmac_secret-from-INGEST_SOURCES-for-this-source-slug>,
  data = "${X-Witus-Timestamp}.${rawBody}"
)
header = "sha256=" + hex(signature)
```

The dot between timestamp and rawBody is literal. The rawBody is the **exact bytes** the publisher sends as the request body, not a re-serialized JSON object. Hash before any framework middleware can touch the bytes.

Verification on the receiver:

1. Parse `X-Witus-Timestamp` as an integer. Reject if non-finite or `|now - ts| > 300s` (the 5-minute replay window).
2. Recompute `HMAC_SHA256(secret, "${ts}.${rawBody}")`.
3. Constant-time compare against the header's hex (after stripping any `sha256=` prefix). Length-mismatched buffers reject without comparison.

The constant-time compare is the [`timingSafeEqual`](https://nodejs.org/api/crypto.html#cryptotimingsafeequalsa-b) built-in. The full implementation is in [`lib/hmac.ts`](../lib/hmac.ts).

### Secret requirements

`hmac_secret` values in `INGEST_SOURCES` **MUST be at least 32 characters**. Generate with:

```bash
openssl rand -hex 32   # 64 hex chars, 32 bytes of entropy
```

The receiver enforces this via Zod; an entry below the minimum invalidates the entire `INGEST_SOURCES` array (the loader returns an empty map, so every request comes back "unknown source"). The fail-closed shape is intentional: a misconfigured deploy doesn't fall through into weak-key territory.

### Per-environment secrets

Production, preview, and local dev each get **distinct** secrets. Rotating one environment never affects another. When you onboard a new publisher product:

1. Generate one secret per environment (`openssl rand -hex 32`).
2. Add an entry to the receiver's `INGEST_SOURCES` for each environment.
3. Mirror the matching value into the publisher's environment as `INBOX_INGEST_SECRET` (or whatever name your sender uses).

## Failure modes (canonical)

| Receiver status | Reason | Diagnostic log line |
|---|---|---|
| 200 | Accepted; submission inserted | `[ingest] accepted source=… form_type=… id=…` |
| 401 | Missing required header | (no log) |
| 401 | `X-Witus-Source` not in `INGEST_SOURCES` | `[ingest] unknown source` |
| 401 | Timestamp >5 min skew **or** signature mismatch | `[ingest] hmac verify failed source=…` |
| 400 | Body not valid JSON | `[ingest] invalid JSON source=…` |
| 400 | JSON valid, payload schema rejected | `[ingest] schema invalid source=…` |
| 500 | Database error | `[ingest] insert failed source=… err=<class>` (PII never logged) |

**The body for every non-success is `{"ok":false}`** with no diagnostic detail in the response. Diagnostics live on the receiver side only, on purpose.

## Working `curl` example

The same flow the bundled smoke-test script ([`scripts/smoke-test-bam-landing-page.ts`](../scripts/smoke-test-bam-landing-page.ts)) executes, written for one-off shell use. Replace the `SECRET` and `BODY` to match your setup.

```bash
SECRET="<the hmac_secret for your source slug>"
SOURCE="my-publisher-slug"
INBOX="http://localhost:3000/api/ingest"

BODY=$(cat <<'JSON'
{"form_type":"contact","submitter_email":"alice@example.com","submitter_name":"Alice","priority":"normal","payload":{"message":"hello from curl"}}
JSON
)
TIMESTAMP=$(date +%s)
SIGNATURE=$(printf '%s.%s' "$TIMESTAMP" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')

curl -i -X POST "$INBOX" \
  -H "Content-Type: application/json" \
  -H "X-Witus-Source: $SOURCE" \
  -H "X-Witus-Timestamp: $TIMESTAMP" \
  -H "X-Witus-Signature: sha256=$SIGNATURE" \
  --data-raw "$BODY"
```

Expected response on success:

```
HTTP/1.1 200 OK
Content-Type: application/json

{"ok":true,"id":"<uuid>"}
```

If you get 401 with no further body: re-check the source slug and the secret-string match. The receiver's stderr (in your `next dev` window or Vercel function log) names which check failed.

## Sender stub (pseudo-code)

A drop-in TypeScript sender lives at [`examples/sender.ts`](../examples/sender.ts). Copy-paste it into your publisher product. Integration patterns for Next.js Server Actions, Express, and other-language senders are in [`examples/README.md`](../examples/README.md). The pseudo-code below is language-agnostic:

```
function sendToInbox(formData):
    body       = json.stringify({
                   form_type:        formData.form_type,
                   submitter_email:  formData.email,
                   submitter_name:   formData.name,
                   priority:         deriveFromFormType(formData.form_type),
                   payload:          formData,
                 })
    timestamp  = now_unix_seconds()
    signature  = hmac_sha256(env.INBOX_INGEST_SECRET, timestamp + "." + body)

    response = http.post(
      url    = env.INBOX_INGEST_URL,                 # e.g. https://inbox.example.com/api/ingest
      body   = body,
      headers = {
        "Content-Type":      "application/json",
        "X-Witus-Source":    env.INBOX_SOURCE_SLUG,
        "X-Witus-Timestamp": timestamp,
        "X-Witus-Signature": "sha256=" + hex(signature),
      },
    )

    if response.status >= 400:
      log_failure(source = env.INBOX_SOURCE_SLUG,
                  form_type = formData.form_type,
                  http_status = response.status)
      # Do NOT block the user-facing form response on this. The receiver
      # is a side-channel; the publisher's own "thank you" should already
      # have rendered.
```

Three rules for sender authors:

1. **Sign the exact bytes you send.** Don't re-serialize between hashing and POSTing. JSON whitespace, key order, and number formatting all matter for the hash.
2. **Don't block the user.** Send to the receiver after the user-facing response is already rendered (Next.js's `after()`, a fire-and-forget `fetch` with logged-not-thrown errors, etc.).
3. **Log at most `source`, `form_type`, and the HTTP status.** Never log the body, the secret, or the signature.

## Inbound replies (submitter → inbox)

If your inbox has the inbound route configured (see `docs/deploy-vercel-neon.md` §7a), submitter replies thread back into the same submission's history. The wiring:

1. Outbound replies the inbox sends out carry a per-submission `Reply-To: inbox+<submission-uuid>@<MAILGUN_DOMAIN>`.
2. When the submitter clicks Reply, their mail client routes the reply to that subaddress.
3. Mailgun's MX accepts it. A receiving route forwards the parsed message to `POST /api/inbound-email` on the inbox.
4. The inbox verifies the Mailgun webhook signature (HMAC-SHA256 over `${timestamp}${token}` with the `MAILGUN_WEBHOOK_SIGNING_KEY`), extracts the submission UUID from the recipient subaddress, and inserts a `replies` row with `direction='inbound'`.
5. If the submission's status was `replied` or `closed`, it's flipped back to `in_progress` so the row resurfaces in the triage queue.

This is opt-in. With `MAILGUN_WEBHOOK_SIGNING_KEY` unset, the inbox sends outbound replies normally and submitter replies fall through to whatever your `Reply-To` setup was previously (typically your DR archive Gmail). The inbox's `/api/inbound-email` route returns 503 for every request in that case, so Mailgun retries decay quickly.

## Versioning

The contract is versioned by major-version repository tag. v0 (current) and v1 are wire-compatible. A v2 with a breaking change (for example, a new required header, or a payload-schema field promoted from optional to required) would ship with a 90-day deprecation window during which both versions are accepted, controlled by a `X-Witus-Contract-Version: 1` header that defaults to `1` when absent.

If you fork to add a contract change for your own ecosystem, please don't reuse the `X-Witus-*` header namespace. Pick your own (`X-MyCo-*`) so anyone running both can keep them straight.
