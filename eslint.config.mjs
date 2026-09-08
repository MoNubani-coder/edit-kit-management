import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The end-to-end run's own build directory and artefacts (Phase 13).
    ".next-e2e/**",
    "playwright-report/**",
    "test-results/**",
    "storage-e2e/**",
  ]),
]);

export default eslintConfig;
