import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // react-hooks' React Compiler checks (set-state-in-effect, refs,
    // preserve-manual-memoization) stay at their default "error" level. Where
    // a flagged pattern is intentional (reading localStorage after hydration,
    // fetch/polling effects, a ref used only inside an event handler), the
    // line carries an eslint-disable comment with the reason.
    rules: {
      // next/image is not used under vinext; images here are mostly data: URLs
      // (avatars, company logo), which next/image would not optimise anyway.
      "@next/next/no-img-element": "off",
      // A leading underscore marks a parameter/binding as deliberately unused
      // (e.g. `({ detailTable: _d, ...rest })`, `(_h, _r) => …`).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // vinext build output
    "dist/**",
  ]),
]);

export default eslintConfig;
