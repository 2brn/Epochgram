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

const epochUiTermCase = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      useEpochCase: "Use 'Epoch' or 'Epochs' (not lowercase) in UI text.",
    },
  },
  create(context) {
    const uiKeys = new Set(["name", "label", "tooltip", "title", "description", "placeholder", "text"]);

    const getPropertyName = (node) => {
      const p = node?.parent;
      if (!p || p.type !== "Property") return "";
      const key = p.key;
      if (!key) return "";
      if (key.type === "Identifier") return key.name || "";
      if (key.type === "Literal" && typeof key.value === "string") return key.value;
      return "";
    };

    const check = (node, value) => {
      if (typeof value !== "string") return;
      const propName = getPropertyName(node);
      if (!uiKeys.has(propName)) return;
      if (!/\bepochs?\b/.test(value)) return;
      context.report({ node, messageId: "useEpochCase" });
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
          "ui-epoch-term-case": epochUiTermCase,
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
          acronyms: ["AI", "ID", "YAML", "ICS"],
          ignoreRegex: ["^Epochgram:\\s", "\\bEpochs?\\b"],
        },
      ],
      "epochgram-internal/ui-prefix-case": "error",
      "epochgram-internal/ui-epoch-term-case": "error",
    },
  }
]);
