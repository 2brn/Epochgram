import { describe, it, expect } from "vitest";
import { TFile } from "./obsidian-mock";
import { pickNewestPendingPath } from "../src/plugin/similarity/files";

describe("pickNewestPendingPath", () => {
	it("prefers newest indexed record date over file mtime", () => {
		const oldFile: any = new TFile("old.md", { stat: { ctime: 0, mtime: 2000, size: 0 } });
		const newFile: any = new TFile("new.md", { stat: { ctime: 0, mtime: 1000, size: 0 } });

		const plugin: any = {
			app: {
				vault: {
					getAbstractFileByPath: (p: string) => (p === "old.md" ? oldFile : p === "new.md" ? newFile : null)
				}
			},
			indexer: {
				getFileIndexData: (p: string) => {
					if (p === "old.md") {
						return { cdate: { date: "2020-01-01" }, namedDate: null, contentDates: [], trackedDates: {} };
					}
					if (p === "new.md") {
						return { cdate: { date: "2025-01-01" }, namedDate: null, contentDates: [], trackedDates: {} };
					}
					return null;
				}
			}
		};

		const pending = new Set<string>(["old.md", "new.md"]);
		expect(pickNewestPendingPath(plugin, pending)).toBe("new.md");
	});

	it("falls back to newest mtime when indexer data is unavailable", () => {
		const a: any = new TFile("a.md", { stat: { ctime: 0, mtime: 10, size: 0 } });
		const b: any = new TFile("b.md", { stat: { ctime: 0, mtime: 20, size: 0 } });
		const plugin: any = {
			app: {
				vault: {
					getAbstractFileByPath: (p: string) => (p === "a.md" ? a : p === "b.md" ? b : null)
				}
			}
		};
		const pending = new Set<string>(["a.md", "b.md"]);
		expect(pickNewestPendingPath(plugin, pending)).toBe("b.md");
	});
});
