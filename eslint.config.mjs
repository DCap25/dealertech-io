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
  {
    rules: {
      /*
        An underscore means "React hands me this and I do not need it".

        Every `useActionState` action must be `(previousState, formData)`
        whether or not it reads either, so the codebase already writes the
        unused ones as `_previous`. The default `args: "after-used"` only
        forgave that when a LATER argument happened to be used, which made the
        warning depend on the shape of the action rather than on anything real
        — an action ignoring both arguments got two warnings for following the
        same convention.

        This formalises the convention the code was already written to.
      */
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
]);

export default eslintConfig;
