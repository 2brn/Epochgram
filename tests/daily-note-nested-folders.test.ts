import { describe, expect, it, vi } from "vitest";
import { TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { createNoteForDate } from "../src/ui/epoch-canvas-actions";

function makeVault() {
	const folders = new Set<string>();
	const files = new Map<string, TFile>();

	const getAbstractFileByPath = (path: string) => {
		const p = String(path || "");
		if (files.has(p)) return files.get(p);
		if (folders.has(p)) return new (TFolder as any)(p);
		return null;
	};

	const createFolder = vi.fn(async (path: string) => {
		const p = String(path || "");
		folders.add(p);
	});

	const create = vi.fn(async (path: string, _data: string) => {
		const p = String(path || "");
		const parent = p.split("/").slice(0, -1).join("/");
		if (parent && !folders.has(parent)) {
			throw Object.assign(new Error(`ENOENT: no such file or directory, open '${p}'`), { code: "ENOENT" });
		}
		const f = new (TFile as any)(p);
		files.set(p, f);
		return f;
	});

	const getFiles = () => Array.from(files.values());

	return { folders, files, getAbstractFileByPath, getFiles, createFolder, create };
}

function makeCanvas(vault: any) {
	const leaf = new WorkspaceLeaf();
	const workspace = {
		getLeaf: () => leaf,
		getMostRecentLeaf: () => leaf,
		getLeavesOfType: () => [leaf],
		revealLeaf: () => {},
		setActiveLeaf: () => {}
	};

	const plugin = {
		app: { vault, workspace },
		getDailyNoteFolder: () => "Epoch QA",
		getDateFormat: (_d: Date) => "2026/01/24"
	};

	return {
		plugin,
		lastFileLeaf: null
	} as any;
}

describe("Daily note creation", () => {
	it("creates parent folders when date format contains slashes", async () => {
		const vault = makeVault();
		const canvas = makeCanvas(vault);

		await createNoteForDate(canvas as any, new Date("2026-01-24T00:00:00.000Z"), false);

		expect(vault.createFolder).toHaveBeenCalledWith("Epoch QA");
		expect(vault.createFolder).toHaveBeenCalledWith("Epoch QA/2026");
		expect(vault.createFolder).toHaveBeenCalledWith("Epoch QA/2026/01");
		expect(vault.create).toHaveBeenCalledWith(
			"Epoch QA/2026/01/24.md",
			expect.stringContaining("date: 2026-01-24")
		);
	});
});
