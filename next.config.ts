import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // Required for the PostHog /ingest proxy below: PostHog's endpoints use trailing slashes and
  // Next would 308 them before the rewrite runs. This disables trailing-slash redirects
  // globally; acceptable here because every page is noindex (robots: index false in the root
  // layout), so there are no duplicate URLs for search engines to find.
  skipTrailingSlashRedirect: true,

  // Proxy PostHog ingest through our own origin so ad blockers don't drop events. The /static
  // rule must come first: assets come from a different upstream host than ingest. The shared
  // project is US region; never point this at the EU cluster (a US key there fails silently).
  // No app route may begin with /ingest (the existing webhook route is /api/ingest, which is fine).
  async rewrites() {
    return [
      { source: "/ingest/static/:path*", destination: "https://us-assets.i.posthog.com/static/:path*" },
      { source: "/ingest/:path*", destination: "https://us.i.posthog.com/:path*" },
    ];
  },
};

// Wrap with Sentry's build plugin (Better Stack ingests through the Sentry SDK). Safe with no
// Sentry env set: without SENTRY_AUTH_TOKEN it simply skips source-map upload (you just get
// minified stack traces), and the runtime SDK stays inert without a DSN. org / project / auth token
// all come from env so nothing secret is committed here.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  webpack: {
    // Strips the SDK's own debug logging from the bundle. Replaces the deprecated top-level
    // `disableLogger` option. Webpack-only, so it is a no-op under Turbopack (same as the old
    // flag was), but it silences the v10 deprecation warning.
    treeshake: { removeDebugLogging: true },
  },
});
