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
  ]),
  // Belt-and-braces guard: the Anthropic SDK must NEVER be imported
  // from a client component. The API key never leaves the server, so
  // any direct SDK import in src/components or a `page.tsx` route
  // would represent a real security regression. Server-only code
  // (route handlers, src/lib/ai/*) is unaffected.
  {
    files: ["src/components/**/*.{ts,tsx}", "src/app/**/page.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@anthropic-ai/sdk",
              message:
                "Do not import @anthropic-ai/sdk from client code. Use the server-side helpers in src/lib/ai/* instead — the API key must never reach the browser.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
