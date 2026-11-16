import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // These three rules come from eslint-plugin-react-hooks' React Compiler
    // checks. This app does not use the React Compiler, and in this codebase
    // they mostly flag legitimate patterns (reading localStorage on mount,
    // starting a polling interval, refs used only inside event handlers) —
    // e.g. react-hooks/refs reports `onMouseDown={(e) => startResize(e, id)}`
    // although the ref is only touched inside the handler. Kept visible as
    // warnings rather than errors so CI lint stays meaningful.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
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
