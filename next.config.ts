import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
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
  disableLogger: true,
});
