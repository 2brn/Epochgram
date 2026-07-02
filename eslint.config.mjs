import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  {
    ignores: [
      "node_modules/**",
      "tests/**",
      "scripts/**",
      "production/**",
      "**/*.js",
      "**/*.mjs",
      "vitest.config.mts",
      "types/**",
    ],
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.eslint.json" },
      globals: {
        window: "readonly",
        activeWindow: "readonly"
      },
    },
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
      "obsidianmd/ui/sentence-case": [
        "error",
        {
          enforceCamelCaseLower: true,
          brands: ["Epochgram", "Pro", "Obsidian", "Google", "Chrome"],
        },
      ],
    },
  },
  {
    files: [
      "src/plugin/ai-bridge/server.ts",
      "src/plugin/maintenance-reset.ts",
    ],
    rules: {
      "import/no-nodejs-modules": "off",
    },
  },
]);
