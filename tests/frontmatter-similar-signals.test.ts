import { beforeEach, describe, expect, it, vi } from "vitest";

import { TFile } from "obsidian";
import { methodsRelatedGraph } from "../src/plugin/similarity/methods-related-graph";
import { withTrustedPro } from "./helpers/trusted-pro";

function makeFile(path: string): TFile {
	const name = path.split("/").pop() ?? path;
	const extension = name.includes(".") ? name.split(".").pop() ?? "" : "";
	const basename = extension ? name.slice(0, -(extension.length + 1)) : name;
	const Ctor = TFile as unknown as new (path: string, options?: Partial<TFile>) => TFile;
	return new Ctor(path, {
		basename,
		extension,
		stat: {
			ctime: Date.UTC(2026, 0, 1),
			mtime: Date.UTC(2026, 0, 1),
			size: 0
		}
	});
}

describe("Frontmatter similar/nosimilar", () => {
	let pluginStub: any;
	let files: TFile[];
	let byPath: Map<string, TFile>;
	let fileCacheByPath: Record<string, any>;

	beforeEach(() => {
		files = [];
		byPath = new Map();
		fileCacheByPath = {};

		const add = (path: string) => {
			const f = makeFile(path);
			files.push(f);
			byPath.set(path, f);
			return f;
		};

		add("A Note.md");
		add("A Note Copy.md");
		add("Linked Only.md");
		add("Tag Intersection Blocked.md");

		pluginStub = {
			settings: {
				similarityUseLinks: true,
				similarityUseTags: true,
				similarityTitleJwThreshold: 0.92
			},
			hasProAccess: () => true,
			app: {
				vault: {
					getAbstractFileByPath: vi.fn((p: string) => byPath.get(p) ?? null),
					getFiles: vi.fn(() => files),
					getMarkdownFiles: vi.fn(() => files)
				},
				metadataCache: {
					resolvedLinks: {},
					getFileCache: vi.fn((f: TFile) => fileCacheByPath[f.path] ?? { frontmatter: {}, tags: [] })
				}
			},
			shouldIndexFile: vi.fn(() => true)
		};
		withTrustedPro(pluginStub);
	});

	it("nosimilar blocks links and title matching", async () => {
		(pluginStub.app.metadataCache.resolvedLinks as any) = {
			"A Note.md": { "Linked Only.md": 1 }
		};

		fileCacheByPath["A Note.md"] = { frontmatter: { nosimilar: true }, tags: [] };
		fileCacheByPath["Linked Only.md"] = { frontmatter: {}, tags: [] };
		fileCacheByPath["A Note Copy.md"] = { frontmatter: {}, tags: [] };

		const related: Set<string> = await methodsRelatedGraph.getGraphRelatedPathsForFile.call(pluginStub, "A Note.md");
		expect(Array.from(related).sort()).toEqual(["A Note.md"]);
	});

	it("similar: [tags] restricts matching and applies symmetrically", async () => {
		(pluginStub.app.metadataCache.resolvedLinks as any) = {
			"A Note.md": { "Linked Only.md": 1 }
		};

		fileCacheByPath["A Note.md"] = { frontmatter: { similar: ["tags"] }, tags: [{ tag: "#x" }] };
		fileCacheByPath["A Note Copy.md"] = { frontmatter: {}, tags: [{ tag: "#x" }] };
		fileCacheByPath["Linked Only.md"] = { frontmatter: {}, tags: [] };
		fileCacheByPath["Tag Intersection Blocked.md"] = { frontmatter: { similar: ["links"] }, tags: [{ tag: "#x" }] };

		const related: Set<string> = await methodsRelatedGraph.getGraphRelatedPathsForFile.call(pluginStub, "A Note.md");
		expect(Array.from(related).sort()).toEqual(["A Note Copy.md", "A Note.md"]);
	});
});
