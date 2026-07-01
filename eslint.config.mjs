import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

const epochgramUiPrefixCase = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      capitalAfterPrefix: "For 'Epochgram: …' UI strings, capitalize the first letter after the prefix.",
    },
  },
  create(context) {
    const check = (node, value) => {
      if (typeof value !== "string") return;
      if (!value.startsWith("Epochgram:")) return;
      const rest = value.slice("Epochgram:".length).trimStart();
      if (!rest) return;
      const ch = rest[0];
      if (ch >= "a" && ch <= "z") {
        context.report({ node, messageId: "capitalAfterPrefix" });
      }
    };

    return {
      Literal(node) {
        check(node, node.value);
      },
      TemplateLiteral(node) {
        const cooked = node.quasis?.[0]?.value?.cooked;
        const raw = node.quasis?.[0]?.value?.raw;
        check(node, cooked ?? raw ?? null);
      },
    };
  },
};

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
    plugins: {
      "epochgram-internal": {
        rules: {
          "ui-prefix-case": epochgramUiPrefixCase,
        },
      },
    },
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
      "obsidianmd/ui/sentence-case": [
        "error",
        {
          enforceCamelCaseLower: true,
          brands: ["Epochgram", "Pro", "Obsidian", "Google", "Chrome"],
          ignoreRegex: ["^Epochgram:\\s", "^\\(Clear\\)$"],
        },
      ],
      "epochgram-internal/ui-prefix-case": "error",
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
