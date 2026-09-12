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
    ".generated/**",
    ".next-*/**",
    "out/**",
    "build/**",
    ".claude/**",
    "**/.worktrees/**",
    ".codex-worktrees/**",
    "next-env.d.ts",
    // Published, versioned third-party runtime; lint the application source.
    "public/vendor/model-viewer/**",
  ]),
]);

export default eslintConfig;
