import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";

import { descriptionFrontmatterMethods } from "../src/plugin/description-frontmatter";

function makeFile(path: string): TFile {
	const name = path.split("/").pop() ?? path;
	const extension = name.includes(".") ? name.split(".").pop() ?? "" : "";
	const basename = extension ? name.slice(0, -(extension.length + 1)) : name;
	const Ctor = TFile as unknown as new (path: string, options?: Partial<TFile>) => TFile;
	return new Ctor(path, {
		basename,
		extension,
		stat: {
			ctime: Date.now(),
			mtime: Date.now(),
			size: 0
		}
	});
}

describe("Description frontmatter methods", () => {
	it("writes YAML description via manual fallback when processFrontMatter is unavailable", async () => {
		const file = makeFile("folder/note.md");
		let raw = "Body";
		const plugin: any = {
			app: {
				vault: {
					read: vi.fn(async () => raw),
					modify: vi.fn(async (_file: TFile, next: string) => {
						raw = next;
					}),
					getAbstractFileByPath: vi.fn((path: string) => (path === file.path ? file : null))
				},
				metadataCache: {
					getFileCache: vi.fn(() => ({ frontmatter: {}, tags: [] }))
				}
			},
			ensureIndexLoaded: vi.fn(async () => {}),
			waitForExcludedSync: vi.fn(async () => {}),
			shouldIndexFile: vi.fn(() => true),
			refreshEpochViews: vi.fn()
		};

		const changed = await descriptionFrontmatterMethods.setYamlDescriptionForFile.call(plugin, file, "A summary");

		expect(changed).toBe(true);
		expect(raw).toBe(["---", "description: A summary", "---", "", "Body"].join("\n"));
	});

	it("removes YAML description while preserving other frontmatter keys", async () => {
		const file = makeFile("folder/note.md");
		let raw = ["---", "date: 2026-05-01", "description: Remove me", "---", "Body"].join("\n");
		const plugin: any = {
			app: {
				vault: {
					read: vi.fn(async () => raw),
					modify: vi.fn(async (_file: TFile, next: string) => {
						raw = next;
					}),
					getAbstractFileByPath: vi.fn((path: string) => (path === file.path ? file : null))
				},
				metadataCache: {
					getFileCache: vi.fn(() => ({ frontmatter: { date: "2026-05-01", description: "Remove me" }, tags: [] }))
				}
			},
			ensureIndexLoaded: vi.fn(async () => {}),
			waitForExcludedSync: vi.fn(async () => {}),
			shouldIndexFile: vi.fn(() => true),
			refreshEpochViews: vi.fn()
		};

		const changed = await descriptionFrontmatterMethods.setYamlDescriptionForFile.call(plugin, file, "");

		expect(changed).toBe(true);
		expect(raw).toBe(["---", "date: 2026-05-01", "---", "Body"].join("\n"));
	});

	it("uses custom YAML description property name", async () => {
		const file = makeFile("folder/custom.md");
		let raw = ["---", "summary: Existing", "---", "Body"].join("\n");
		const plugin: any = {
			settings: {
				yamlDescriptionProperty: "summary"
			},
			app: {
				vault: {
					read: vi.fn(async () => raw),
					modify: vi.fn(async (_file: TFile, next: string) => {
						raw = next;
					}),
					getAbstractFileByPath: vi.fn((path: string) => (path === file.path ? file : null))
				},
				metadataCache: {
					getFileCache: vi.fn(() => ({ frontmatter: { summary: "Existing" }, tags: [] }))
				}
			},
			ensureIndexLoaded: vi.fn(async () => {}),
			waitForExcludedSync: vi.fn(async () => {}),
			shouldIndexFile: vi.fn(() => true),
			refreshEpochViews: vi.fn()
		};

		const changed = await descriptionFrontmatterMethods.setYamlDescriptionForFile.call(plugin, file, "Updated");

		expect(changed).toBe(true);
		expect(raw).toBe(["---", "summary: Updated", "---", "Body"].join("\n"));
	});
});