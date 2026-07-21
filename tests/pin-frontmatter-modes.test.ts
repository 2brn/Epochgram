import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";

import { getYamlPropertyForFile, readYamlPropertyFromText, setYamlPropertyForFile } from "../src/plugin/note-frontmatter";

function makeFile(path: string): TFile {
	const name = path.split("/").pop() ?? path;
	const extension = name.includes(".") ? name.split(".").pop() ?? "" : "";
	const basename = extension ? name.slice(0, -(extension.length + 1)) : name;
	const Ctor = TFile as unknown as new (path: string, options?: Partial<TFile>) => TFile;
	return new Ctor(path, {
		basename,
		extension,
		stat: {
			ctime: 0,
			mtime: 0,
			size: 0
		}
	});
}

describe("pin frontmatter modes", () => {
	it("reads bare and valued pin properties from raw frontmatter", () => {
			expect(readYamlPropertyFromText(["---", "pin:", "---"].join("\n"), "pin")).toBe("");
		expect(readYamlPropertyFromText(["---", "pin: today", "---"].join("\n"), "pin")).toBe("today");
		expect(readYamlPropertyFromText(["---", "pin: date", "---"].join("\n"), "pin")).toBe("date");
			expect(readYamlPropertyFromText(["---", "pin: dock", "---"].join("\n"), "pin")).toBe("dock");
		expect(readYamlPropertyFromText(["---", "pin: weird", "---"].join("\n"), "pin")).toBe("weird");
	});

	it("writes pin: today and removes pin on unpin", async () => {
		const file = makeFile("folder/note.md");
		let raw = ["---", "date: 2025-01-01", "---", "body"].join("\n");
		const plugin: any = {
			app: {
				metadataCache: {
					getFileCache: vi.fn(() => ({ frontmatter: {} }))
				},
				vault: {
					read: vi.fn(async () => raw),
					modify: vi.fn(async (_file: TFile, next: string) => {
						raw = next;
					})
				}
			}
		};

		expect(await setYamlPropertyForFile(plugin, file, "pin", "today")).toBe(true);
		expect(raw).toContain("pin: today");
		expect(await getYamlPropertyForFile(plugin, file, "pin")).toBe("today");

		plugin.app.metadataCache.getFileCache.mockImplementation(() => ({ frontmatter: { pin: "today" } }));
		expect(await setYamlPropertyForFile(plugin, file, "pin", null)).toBe(true);
		expect(raw).not.toContain("pin:");
	});
});