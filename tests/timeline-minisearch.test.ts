import { describe, expect, it } from "vitest";

import { TimelineSearchIndex } from "../src/search/timeline-search-index";

describe("timeline minisearch index", () => {
	it("matches substring tokens with AND semantics", () => {
		const idx = new TimelineSearchIndex();
		idx.upsert({
			id: "A.md",
			kind: "file",
			path: "A.md",
			basename: "A",
			directory: "",
			meta: "",
			content: "alpha then beta"
		});
		idx.upsert({
			id: "B.md",
			kind: "file",
			path: "B.md",
			basename: "B",
			directory: "",
			meta: "",
			content: "alpha only"
		});

		const out = idx.searchFileIds({ includeText: "alpha beta", exactPhrases: [], excludedPhrases: [], excludeTokens: [] });
		expect(Array.from(out).sort()).toEqual(["A.md"]);
	});

	it("supports fuzzy matching (MiniSearch fuzzy)", () => {
		const idx = new TimelineSearchIndex();
		idx.upsert({
			id: "note.md",
			kind: "file",
			path: "note.md",
			basename: "note",
			directory: "",
			meta: "",
			content: "Obsidian plugin timeline"
		});

		const out = idx.searchFileIds({ includeText: "obsdian", exactPhrases: [], excludedPhrases: [], excludeTokens: [] });
		expect(out.has("note.md")).toBe(true);
	});

	it("matches Unicode terms", () => {
		const idx = new TimelineSearchIndex();
		idx.upsert({
			id: "cyr.md",
			kind: "file",
			path: "cyr.md",
			basename: "cyr",
			directory: "",
			meta: "",
			content: "Стан «худоби».md\nЩось про худоби."
		});

		const out = idx.searchFileIds({ includeText: "худоби", exactPhrases: [], excludedPhrases: [], excludeTokens: [] });
		expect(out.has("cyr.md")).toBe(true);
	});

	it("supports exclusions", () => {
		const idx = new TimelineSearchIndex();
		idx.upsert({
			id: "A.md",
			kind: "file",
			path: "A.md",
			basename: "A",
			directory: "",
			meta: "",
			content: "alpha beta"
		});
		idx.upsert({
			id: "B.md",
			kind: "file",
			path: "B.md",
			basename: "B",
			directory: "",
			meta: "",
			content: "alpha"
		});

		const out = idx.searchFileIds({ includeText: "alpha", exactPhrases: [], excludedPhrases: [], excludeTokens: ["beta"] });
		expect(Array.from(out).sort()).toEqual(["B.md"]);
	});

	it("avoids overly-fuzzy Cyrillic false positives", () => {
		const idx = new TimelineSearchIndex();
		idx.upsert({
			id: "good.md",
			kind: "file",
			path: "good.md",
			basename: "good",
			directory: "",
			meta: "",
			content: "Стан худоби"
		});
		idx.upsert({
			id: "bad.md",
			kind: "file",
			path: "bad.md",
			basename: "bad",
			directory: "",
			meta: "",
			content: "Чудова історія"
		});

		const out = idx.searchFileIds({ includeText: "худоба", exactPhrases: [], excludedPhrases: [], excludeTokens: [] });
		expect(Array.from(out).sort()).toEqual(["good.md"]);
	});

	it("matches diacritics-insensitively", () => {
		const idx = new TimelineSearchIndex();
		idx.upsert({
			id: "cafe.md",
			kind: "file",
			path: "cafe.md",
			basename: "cafe",
			directory: "",
			meta: "",
			content: "Café au lait"
		});
		const out = idx.searchFileIds({ includeText: "cafe", exactPhrases: [], excludedPhrases: [], excludeTokens: [] });
		expect(out.has("cafe.md")).toBe(true);
	});

	it("tokenizes camelCase", () => {
		const idx = new TimelineSearchIndex();
		idx.upsert({
			id: "code.md",
			kind: "file",
			path: "code.md",
			basename: "code",
			directory: "",
			meta: "",
			content: "Use fooBarBaz in config"
		});
		const out = idx.searchFileIds({ includeText: "foo bar", exactPhrases: [], excludedPhrases: [], excludeTokens: [] });
		expect(out.has("code.md")).toBe(true);
	});

	it("supports exact phrases and excluded phrases via post-filter", () => {
		const idx = new TimelineSearchIndex();
		idx.upsert({
			id: "A.md",
			kind: "file",
			path: "A.md",
			basename: "A",
			directory: "",
			meta: "",
			content: "alpha beta gamma"
		});
		idx.upsert({
			id: "B.md",
			kind: "file",
			path: "B.md",
			basename: "B",
			directory: "",
			meta: "",
			content: "alpha beta"
		});

		const includePhrase = idx.searchFileIds({
			includeText: "alpha",
			exactPhrases: ["beta gamma"],
			excludedPhrases: [],
			excludeTokens: []
		});
		expect(Array.from(includePhrase).sort()).toEqual(["A.md"]);

		const excludePhrase = idx.searchFileIds({
			includeText: "alpha",
			exactPhrases: [],
			excludedPhrases: ["beta gamma"],
			excludeTokens: []
		});
		expect(Array.from(excludePhrase).sort()).toEqual(["B.md"]);
	});

	it("matches exact phrases across common separators", () => {
		const idx = new TimelineSearchIndex();
		idx.upsert({
			id: "a.md",
			kind: "file",
			path: "a.md",
			basename: "a",
			directory: "",
			meta: "",
			content: "Altimeter-Setting and Altimeter: Setting"
		});
		const out = idx.searchFileIds({ includeText: "", exactPhrases: ["Altimeter Setting"], excludedPhrases: [], excludeTokens: [] });
		expect(out.has("a.md")).toBe(true);
	});

	it("does not require 1-letter alpha tokens (e.g. trailing-dot initials)", () => {
		const idx = new TimelineSearchIndex();
		idx.upsert({
			id: "ref.md",
			kind: "file",
			path: "ref.md",
			basename: "ref",
			directory: "",
			meta: "",
			content:
				"[^nginx]: Rawdat A. Announcing NGINX Ingress Controller for Kubernetes Release 1.8.0 - NGINX. (2020)."
		});

		const out = idx.searchFileIds({ includeText: "Rawdat A.", exactPhrases: [], excludedPhrases: [], excludeTokens: [] });
		expect(out.has("ref.md")).toBe(true);
	});
});
