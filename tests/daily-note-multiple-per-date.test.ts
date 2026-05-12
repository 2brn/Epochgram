import { describe, expect, it, vi } from "vitest";
import { TFile, TFolder } from "obsidian";

import { getFileForDate, getNextDailyNoteCreatePath } from "../src/ui/epoch-canvas-helpers";
import { createNoteForDate } from "../src/ui/epoch-canvas-actions";

function makeVault(initialPaths: string[] = []) {
	const folders = new Set<string>();
	const files = new Map<string, TFile>();

	for (const p of initialPaths) {
		files.set(p, new (TFile as any)(p));
	}

	const getAbstractFileByPath = (path: string) => {
		const p = String(path || "");
		if (files.has(p)) return files.get(p);
		if (folders.has(p)) return new (TFolder as any)(p);
		return null;
	};

	const createFolder = vi.fn(async (path: string) => {
		folders.add(String(path || ""));
	});

	const create = vi.fn(async (path: string, data: string) => {
		const p = String(path || "");
		files.set(p, new (TFile as any)(p));
		return files.get(p)!;
	});

	const getFiles = () => Array.from(files.values());

	return { folders, files, getAbstractFileByPath, createFolder, create, getFiles };
}

function makeCanvas(vault: any, baseName: string) {
	const leaf: any = {
		openFile: vi.fn(async () => {}),
		view: {}
	};
	const workspace: any = {
		getLeaf: vi.fn(() => leaf),
		getMostRecentLeaf: vi.fn(() => leaf),
		getLeavesOfType: vi.fn(() => [leaf]),
		revealLeaf: vi.fn(() => {}),
		setActiveLeaf: vi.fn(() => {})
	};
	const plugin: any = {
		app: { vault, workspace },
		getDailyNoteFolder: () => "",
		getDateFormat: () => baseName
	};
	return { plugin, lastFileLeaf: null } as any;
}

describe("Daily notes: multiple notes per date", () => {
	it("getFileForDate opens base note when present", () => {
		const base = "2026-03-14";
		const vault = makeVault(["2026-03-14.md", "2026-03-14 (1).md"]);
		const canvas = makeCanvas(vault, base);
		const hit = getFileForDate(canvas, new Date("2026-03-14T00:00:00.000Z"));
		expect(hit?.path).toBe("2026-03-14.md");
	});

	it("getFileForDate opens the first available paren note when base is missing", () => {
		const base = "2026-03-14";
		const vault = makeVault(["2026-03-14 (2).md"]);
		const canvas = makeCanvas(vault, base);
		const hit = getFileForDate(canvas, new Date("2026-03-14T00:00:00.000Z"));
		expect(hit?.path).toBe("2026-03-14 (2).md");
	});

	it("getNextDailyNoteCreatePath returns base when missing", () => {
		const base = "2026-03-14";
		const vault = makeVault(["2026-03-14 (1).md"]);
		const canvas = makeCanvas(vault, base);
		const next = getNextDailyNoteCreatePath(canvas, new Date("2026-03-14T00:00:00.000Z"));
		expect(next.path).toBe("2026-03-14.md");
		expect(next.fileName).toBe("2026-03-14.md");
	});

	it("getNextDailyNoteCreatePath skips numbers used by either style and fills gaps", () => {
		const base = "2026-03-14";
		const vault = makeVault([
			"2026-03-14.md",
			"2026-03-14 (1).md",
			"2026-03-14 (3).md"
		]);
		const canvas = makeCanvas(vault, base);
		const next = getNextDailyNoteCreatePath(canvas, new Date("2026-03-14T00:00:00.000Z"));
		expect(next.path).toBe("2026-03-14 (2).md");
	});

	it("createNoteForDate creates the next file and writes YAML date", async () => {
		const base = "2026-03-14";
		const vault = makeVault(["2026-03-14.md", "2026-03-14 (1).md"]);
		const canvas = makeCanvas(vault, base);

		await createNoteForDate(canvas, new Date("2026-03-14T00:00:00.000Z"), false);

		expect(vault.create).toHaveBeenCalledTimes(1);
		const [path, data] = vault.create.mock.calls[0];
		expect(path).toBe("2026-03-14 (2).md");
		expect(String(data)).toContain("---\ndate: 2026-03-14\n---");
	});

	it("createNoteForDate uses daily-note template content when available", async () => {
		const base = "2026-03-14";
		const vault = makeVault();
		const leaf: any = {
			openFile: vi.fn(async () => {}),
			view: {}
		};
		const workspace: any = {
			getLeaf: vi.fn(() => leaf),
			getMostRecentLeaf: vi.fn(() => leaf),
			getLeavesOfType: vi.fn(() => [leaf]),
			revealLeaf: vi.fn(() => {}),
			setActiveLeaf: vi.fn(() => {})
		};
		const getDailyNoteTemplateContent = vi.fn(async (_d: Date, notePath: string) => `from template: ${notePath}`);
		const plugin: any = {
			app: { vault, workspace },
			getDailyNoteFolder: () => "",
			getDateFormat: () => base,
			getDailyNoteTemplateContent
		};
		const canvas = { plugin, lastFileLeaf: null } as any;

		await createNoteForDate(canvas, new Date("2026-03-14T00:00:00.000Z"), false);

		expect(getDailyNoteTemplateContent).toHaveBeenCalledWith(expect.any(Date), "2026-03-14.md");
		expect(vault.create).toHaveBeenCalledTimes(1);
		const [_path, data] = vault.create.mock.calls[0];
		expect(String(data)).toBe("from template: 2026-03-14.md");
	});

	it("createNoteForDate uses configured YAML date property key", async () => {
		const base = "2026-03-14";
		const vault = makeVault();
		const leaf: any = {
			openFile: vi.fn(async () => {}),
			view: {}
		};
		const workspace: any = {
			getLeaf: vi.fn(() => leaf),
			getMostRecentLeaf: vi.fn(() => leaf),
			getLeavesOfType: vi.fn(() => [leaf]),
			revealLeaf: vi.fn(() => {}),
			setActiveLeaf: vi.fn(() => {})
		};
		const plugin: any = {
			settings: { yamlDateProperty: "anchor" },
			app: { vault, workspace },
			getDailyNoteFolder: () => "",
			getDateFormat: () => base
		};
		const canvas = { plugin, lastFileLeaf: null } as any;

		await createNoteForDate(canvas, new Date("2026-03-14T00:00:00.000Z"), false);

		expect(vault.create).toHaveBeenCalledTimes(1);
		const [_path, data] = vault.create.mock.calls[0];
		expect(String(data)).toContain("---\nanchor: 2026-03-14\n---");
	});

	it("createNoteForDate uses current time for path when format has time tokens", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 4, 4, 15, 16, 17, 890));

		const vault = makeVault();
		const leaf: any = {
			openFile: vi.fn(async () => {}),
			view: {}
		};
		const workspace: any = {
			getLeaf: vi.fn(() => leaf),
			getMostRecentLeaf: vi.fn(() => leaf),
			getLeavesOfType: vi.fn(() => [leaf]),
			revealLeaf: vi.fn(() => {}),
			setActiveLeaf: vi.fn(() => {})
		};
		const plugin: any = {
			app: { vault, workspace },
			getDailyNoteFolder: () => "",
			getDailyNoteFormat: () => "YYYYMMDDHHmmssSSS",
			getDateFormat: (d: Date) => {
				const y = String(d.getFullYear()).padStart(4, "0");
				const m = String(d.getMonth() + 1).padStart(2, "0");
				const day = String(d.getDate()).padStart(2, "0");
				const hh = String(d.getHours()).padStart(2, "0");
				const mm = String(d.getMinutes()).padStart(2, "0");
				const ss = String(d.getSeconds()).padStart(2, "0");
				const sss = String(d.getMilliseconds()).padStart(3, "0");
				return `${y}${m}${day}${hh}${mm}${ss}${sss}`;
			}
		};
		const canvas = { plugin, lastFileLeaf: null } as any;

		await createNoteForDate(canvas, new Date(2026, 4, 4, 0, 0, 0, 0), false);

		expect(vault.create).toHaveBeenCalledTimes(1);
		const [path] = vault.create.mock.calls[0];
		expect(path).toBe("20260504151617890.md");

		vi.useRealTimers();
	});

	it("createNoteForDate preserves selected day but uses current time outside today", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 4, 4, 15, 16, 17, 890));

		const vault = makeVault();
		const leaf: any = {
			openFile: vi.fn(async () => {}),
			view: {}
		};
		const workspace: any = {
			getLeaf: vi.fn(() => leaf),
			getMostRecentLeaf: vi.fn(() => leaf),
			getLeavesOfType: vi.fn(() => [leaf]),
			revealLeaf: vi.fn(() => {}),
			setActiveLeaf: vi.fn(() => {})
		};
		const plugin: any = {
			app: { vault, workspace },
			getDailyNoteFolder: () => "",
			getDailyNoteFormat: () => "YYYYMMDDHHmmssSSS",
			getDateFormat: (d: Date) => {
				const y = String(d.getFullYear()).padStart(4, "0");
				const m = String(d.getMonth() + 1).padStart(2, "0");
				const day = String(d.getDate()).padStart(2, "0");
				const hh = String(d.getHours()).padStart(2, "0");
				const mm = String(d.getMinutes()).padStart(2, "0");
				const ss = String(d.getSeconds()).padStart(2, "0");
				const sss = String(d.getMilliseconds()).padStart(3, "0");
				return `${y}${m}${day}${hh}${mm}${ss}${sss}`;
			}
		};
		const canvas = { plugin, lastFileLeaf: null } as any;

		await createNoteForDate(canvas, new Date(2026, 4, 2, 0, 0, 0, 0), false);

		expect(vault.create).toHaveBeenCalledTimes(1);
		const [path] = vault.create.mock.calls[0];
		expect(path).toBe("20260502151617890.md");

		vi.useRealTimers();
	});
});
