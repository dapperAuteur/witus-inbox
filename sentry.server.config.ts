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
    // Tracing belongs to @vercel/otel → Honeycomb (otel.config.ts). Sentry v8+ installs its own
    // OpenTelemetry provider by default even at tracesSampleRate 0; two global providers race and
    // the loser silently drops its spans. Error capture does not need a provider, so skipping
    // Sentry's OTel setup costs nothing here.
    skipOpenTelemetrySetup: true,
    // Never auto-attach IP / cookies / user email. The beforeSend scrub is the second line.
    sendDefaultPii: false,
    beforeSend: scrubEvent,
  });
}
