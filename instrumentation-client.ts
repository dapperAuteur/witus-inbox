import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/sentry-scrub";

// Client-runtime Sentry init. Reads the PUBLIC DSN (inlined at build). Guarded: with no
// NEXT_PUBLIC_SENTRY_DSN the SDK is inert, so nothing is sent and the inbox UI is unchanged.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    // Errors only: no tracing, and NO session replay. Replay would record the inbox screen, which
    // is every sibling app's submitter names, emails and free text. Not a thing to ship offsite.
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
  });
}

// Instruments App Router client navigations for Sentry (no-op when not initialized).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
