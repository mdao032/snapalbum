import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Base ESLint rules shared by every workspace.
 * `any` is forbidden unless justified with an explicit disable comment (NF-040).
 */
export const baseConfig = tseslint.config(
  { ignores: ["**/node_modules/**", "**/.next/**", "**/.turbo/**", "**/coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
);

export default baseConfig;
