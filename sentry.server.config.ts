import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/sentry-scrub";

// Server-runtime Sentry init (Better Stack ingests through the Sentry SDK, so the DSN is whatever
// Better Stack issues for this source). Loaded from instrumentation.ts's register() on Node.
// GUARDED ON THE DSN: with no SENTRY_DSN set, init is skipped entirely and the SDK is inert, so the
// app ships and runs exactly as before until BAM provisions a source and sets the var
// (plans/user-tasks/15-betterstack-sentry-dsn.md).
const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    // Errors only for now: no tracing spend, and no span attributes carrying signed payloads.
    tracesSampleRate: 0,
    // Never auto-attach IP / cookies / user email. The beforeSend scrub is the second line.
    sendDefaultPii: false,
    beforeSend: scrubEvent,
  });
}
