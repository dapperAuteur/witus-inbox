import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // lib/analytics/posthog-provider.tsx is a byte-for-byte copy of the witus-online original
  // (INTEGRATE.md step 3: "Copy unchanged"), so it is not edited here to satisfy lint. Its one
  // synchronous setState marks an already-initialized posthog-js singleton as ready, which is
  // syncing from an external system. Scoped to that file only; the rule stays on everywhere else.
  {
    files: ["lib/analytics/posthog-provider.tsx"],
    rules: { "react-hooks/set-state-in-effect": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
