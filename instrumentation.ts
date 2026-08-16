import * as Sentry from "@sentry/nextjs";
import type { Instrumentation } from "next";

// Next.js instrumentation hook. Loads the right Sentry config per runtime, and reports server-side
// App Router errors via onRequestError. Everything is inert without a SENTRY_DSN (see the configs).
export async function register() {
  // OTel first: it must own the global tracer provider before Sentry loads (Sentry is told to skip
  // its own OTel setup — see sentry.server.config.ts). Inert without the Honeycomb key.
  const { registerHoneycombOtel } = await import("./otel.config");
  registerHoneycombOtel();

  if (process.env.NEXT_RUNTIME === "nodejs") await import("./sentry.server.config");
  if (process.env.NEXT_RUNTIME === "edge") await import("./sentry.edge.config");
}

// Captures errors thrown while rendering/serving a request. We tag the SENDING APP's slug from the
// `x-witus-source` ingest header, which is how a submission is attributed in this app. The slug is
// a public identifier ("bam-landing-page"), never the shared secret that signs the request, and the
// signature header itself is dropped by the beforeSend scrub.
export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  const raw = request.headers as unknown;
  let source: string | undefined;
  if (raw instanceof Headers) source = raw.get("x-witus-source") ?? undefined;
  else if (raw && typeof raw === "object") {
    const value = (raw as Record<string, unknown>)["x-witus-source"];
    if (typeof value === "string") source = value;
  }
  Sentry.withScope((scope) => {
    // Slugs are short and enumerable; anything longer is not one of ours and is not worth tagging.
    if (source && /^[A-Za-z0-9_-]{1,64}$/.test(source)) scope.setTag("witus.source", source);
    Sentry.captureRequestError(err, request, context);
  });
};
