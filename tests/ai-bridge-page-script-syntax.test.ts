import { describe, expect, it } from "vitest";
import vm from "node:vm";

import { AI_BRIDGE_SCRIPT_PART1 } from "../src/plugin/ai-bridge-page/script-part-ui";
import { AI_BRIDGE_SCRIPT_PART2 } from "../src/plugin/ai-bridge-page/script-part-detect";
import { AI_BRIDGE_SCRIPT_PART3 } from "../src/plugin/ai-bridge-page/script-part-runner";

describe("AI bridge page scripts", () => {
	it("are valid JavaScript (parse-only)", () => {
		expect(() => {
			// Parse-only: validates syntax without executing.
			new vm.Script(`${AI_BRIDGE_SCRIPT_PART1}\n${AI_BRIDGE_SCRIPT_PART2}\n${AI_BRIDGE_SCRIPT_PART3}`);
		}).not.toThrow();
	});

	it("includes cloud apiKey in summarizer cache key", () => {
		expect(AI_BRIDGE_SCRIPT_PART2).toContain("backend.cloud.apiKey");
	});

	it("normalizes backend maxRetries from backend settings", () => {
		expect(AI_BRIDGE_SCRIPT_PART2).toContain("raw.maxRetries");
		expect(AI_BRIDGE_SCRIPT_PART2).toContain("maxRetries");
	});

	it("requires cloud Summarizer and Prompt API polyfills", () => {
		expect(AI_BRIDGE_SCRIPT_PART2).toContain("if (!api || !api.__isPolyfill || !window.LanguageModel?.__isPolyfill)");
		expect(AI_BRIDGE_SCRIPT_PART2).toContain("Cloud AI polyfills failed to load");
	});

	it("preserves backend in fallback summarizer options", () => {
		expect(AI_BRIDGE_SCRIPT_PART2).toContain("backend: o && o.backend ? o.backend : { mode: \"native\" }");
	});

	it("forces cloud prompt and summarizer polyfills before use", () => {
		expect(AI_BRIDGE_SCRIPT_PART2).toContain("async function ensureCloudSummarizerApi(backend)");
		const forcePromptAt = AI_BRIDGE_SCRIPT_PART2.indexOf("window.__FORCE_PROMPT_API_POLYFILL__ = true");
		const forceSummarizerAt = AI_BRIDGE_SCRIPT_PART2.indexOf("window.__FORCE_SUMMARIZER_POLYFILL__ = true");
		const promptImportAt = AI_BRIDGE_SCRIPT_PART2.indexOf("await import(BRIDGE_POLYFILL_PROMPT_MODULE_URL)");
		const summarizerImportAt = AI_BRIDGE_SCRIPT_PART2.indexOf("await import(BRIDGE_POLYFILL_SUMMARIZER_MODULE_URL)");
		expect(forcePromptAt).toBeGreaterThan(-1);
		expect(forceSummarizerAt).toBeGreaterThan(forcePromptAt);
		expect(promptImportAt).toBeGreaterThan(forceSummarizerAt);
		expect(summarizerImportAt).toBeGreaterThan(promptImportAt);
		expect(AI_BRIDGE_SCRIPT_PART2).toContain("Cloud Prompt API polyfill failed to load");
		expect(AI_BRIDGE_SCRIPT_PART2).toContain("!window.LanguageModel?.__isPolyfill");
	});

	it("passes openai baseUrl into OPENAI_CONFIG", () => {
		expect(AI_BRIDGE_SCRIPT_PART2).toContain("baseURL: baseUrl");
	});

	it("installs fetch patch for openai baseUrl routing", () => {
		expect(AI_BRIDGE_SCRIPT_PART2).toContain("installOpenAiBaseUrlFetchPatch(baseUrl)");
		expect(AI_BRIDGE_SCRIPT_PART2).toContain("parsed.hostname !== \"api.openai.com\"");
	});

	it("retries summarize create without language options when unsupported", () => {
		expect(AI_BRIDGE_SCRIPT_PART2).toContain("requested language options are not supported");
		expect(AI_BRIDGE_SCRIPT_PART2).toContain("const relaxed = {");
	});

	it("forces cloud status away from model downloading", () => {
		expect(AI_BRIDGE_SCRIPT_PART1).toContain("if (mode === \"cloud\") {");
		expect(AI_BRIDGE_SCRIPT_PART1).toContain("setModelReadyStatus()");
	});

	it("pauses job processing while native model is downloading", () => {
		expect(AI_BRIDGE_SCRIPT_PART3).toContain("function shouldWaitForModelReady(msg)");
		expect(AI_BRIDGE_SCRIPT_PART3).toContain("waiting for model download");
		expect(AI_BRIDGE_SCRIPT_PART3).toContain("if (shouldWaitForModelReady(msg)) {");
	});

	it("clears gesture errors after user starts model download", () => {
		expect(AI_BRIDGE_SCRIPT_PART2).toContain("downloadBtn.addEventListener(\"click\"");
		expect(AI_BRIDGE_SCRIPT_PART2).toContain("setErrText(\"\")");
		expect(AI_BRIDGE_SCRIPT_PART1).toContain("prevMode !== mode");
	});

	it("validates loaded YAML without persisting it", () => {
		expect(AI_BRIDGE_SCRIPT_PART3).toContain("await validateAndPersistYaml({ persist: false, format: false });");
	});
});
