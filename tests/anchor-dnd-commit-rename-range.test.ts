import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";

import type { DateEntry } from "../src/indexer/types";
import { resolveDateKeyForCanvasDrop } from "../src/plugin/date-frontmatter";
import { commitAnchorEntryDrag, resolveDraggableAnchorEntry } from "../src/ui/epoch-canvas-events/anchor-dnd";

function makeFile(path: string): any {
	const parts = String(path).split("/");
	const name = parts[parts.length - 1] ?? path;
	const dot = name.lastIndexOf(".");
	const extension = dot >= 0 ? name.slice(dot + 1) : "";
	const basename = dot >= 0 ? name.slice(0, dot) : name;
	const f: any = {
		path,
		name,
		extension,
		basename,
		stat: { ctime: Date.now(), mtime: Date.now(), size: 0 }
	};
	Object.setPrototypeOf(f, TFile.prototype);
	return f;
}

describe("Anchor drag-and-drop commit", () => {
	it("does not resolve synthetic pinned-today clones to draggable anchors", () => {
		const pinnedClone: any = {
			date: "2026-04-08",
			originalDate: "2026-04-01",
			pinned: true,
			file: "note.md",
			blockStart: 0,
			blockEnd: 0,
			summary: "",
			source: "namedate",
			reviewState: "reviewed"
		};
		const canvas: any = {
			index: {
				"2026-04-08": [pinnedClone]
			}
		};
		expect(resolveDraggableAnchorEntry(canvas as any, pinnedClone as any)).toBe(null);
	});

	it("renames filename date-range notes by updating only the first date", async () => {
		const dropped = new Date("2026-04-08T12:00:00.000Z");
		const dateKey = resolveDateKeyForCanvasDrop(dropped);

		const file = makeFile("folder/2026-04-01-2026-04-03 note.md");

		const vault = {
			getAbstractFileByPath: vi.fn((p: string) => {
				return String(p) === String(file.path) ? file : null;
			}),
			rename: vi.fn(async (_af: any, newPath: string) => {
				file.path = newPath;
				const parts = String(newPath).split("/");
				file.name = parts[parts.length - 1] ?? newPath;
				const dot = String(file.name).lastIndexOf(".");
				file.basename = dot >= 0 ? String(file.name).slice(0, dot) : String(file.name);
			})
		};

		const plugin: any = {
			app: { vault },
			setYamlDateForPath: vi.fn(async () => true)
		};

		const entry: DateEntry = {
			date: "2026-04-01",
			file: file.path,
			blockStart: 0,
			blockEnd: 0,
			summary: "",
			source: "namedate"
		};

		const canvas: any = {
			plugin,
			canvas: {
				style: {},
				getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100 })
			},
			getToday: () => dropped,
			getDateForIndex: () => dropped,
			draw: vi.fn(),
			clearHover: vi.fn(),
			entryDragActive: true,
			entryDragEntry: entry,
			entryDragTargetDayIndex: 0,
			entryDragLastClientX: 10,
			entryDragLastClientY: 10
		};

		await commitAnchorEntryDrag(canvas as any);

		expect(vault.rename).toHaveBeenCalledTimes(1);
		const renamedTo = String((vault.rename as any).mock.calls[0]?.[1] ?? "");
		expect(renamedTo).toContain("folder/");
		expect(renamedTo).toContain(`${dateKey}-2026-04-03 note.md`);

		expect(plugin.setYamlDateForPath).toHaveBeenCalledTimes(1);
		expect(String((plugin.setYamlDateForPath as any).mock.calls[0]?.[0] ?? "")).toBe(renamedTo);
		expect(String((plugin.setYamlDateForPath as any).mock.calls[0]?.[1] ?? "")).toBe(dateKey);
	});

	it("renames single-date filename notes to the dropped date", async () => {
		const dropped = new Date("2026-04-11T12:00:00.000Z");
		const dateKey = resolveDateKeyForCanvasDrop(dropped);

		const file = makeFile("2026-04-10.md");

		const vault = {
			getAbstractFileByPath: vi.fn((p: string) => {
				return String(p) === String(file.path) ? file : null;
			}),
			rename: vi.fn(async (_af: any, newPath: string) => {
				file.path = newPath;
				const parts = String(newPath).split("/");
				file.name = parts[parts.length - 1] ?? newPath;
				const dot = String(file.name).lastIndexOf(".");
				file.basename = dot >= 0 ? String(file.name).slice(0, dot) : String(file.name);
			})
		};

		const plugin: any = {
			app: { vault },
			setYamlDateForPath: vi.fn(async () => true)
		};

		const entry: DateEntry = {
			date: "2026-04-10",
			file: file.path,
			blockStart: 0,
			blockEnd: 0,
			summary: "",
			source: "namedate"
		};

		const canvas: any = {
			plugin,
			canvas: {
				style: {},
				getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100 })
			},
			getToday: () => dropped,
			getDateForIndex: () => dropped,
			draw: vi.fn(),
			clearHover: vi.fn(),
			entryDragActive: true,
			entryDragEntry: entry,
			entryDragTargetDayIndex: 0,
			entryDragLastClientX: 10,
			entryDragLastClientY: 10
		};

		await commitAnchorEntryDrag(canvas as any);

		expect(vault.rename).toHaveBeenCalledTimes(1);
		const renamedTo = String((vault.rename as any).mock.calls[0]?.[1] ?? "");
		expect(renamedTo).toBe(`${dateKey}.md`);

		expect(plugin.setYamlDateForPath).toHaveBeenCalledTimes(1);
		expect(String((plugin.setYamlDateForPath as any).mock.calls[0]?.[0] ?? "")).toBe(renamedTo);
		expect(String((plugin.setYamlDateForPath as any).mock.calls[0]?.[1] ?? "")).toBe(dateKey);
	});

	it("cancels drag-drop when pointer coordinates are unavailable", async () => {
		const dropped = new Date("2026-04-12T12:00:00.000Z");
		const dateKey = resolveDateKeyForCanvasDrop(dropped);

		const file = makeFile("2026-04-10.md");

		const vault = {
			getAbstractFileByPath: vi.fn((p: string) => {
				return String(p) === String(file.path) ? file : null;
			}),
			rename: vi.fn(async (_af: any, newPath: string) => {
				file.path = newPath;
				const parts = String(newPath).split("/");
				file.name = parts[parts.length - 1] ?? newPath;
				const dot = String(file.name).lastIndexOf(".");
				file.basename = dot >= 0 ? String(file.name).slice(0, dot) : String(file.name);
			})
		};

		const plugin: any = {
			app: { vault },
			setYamlDateForPath: vi.fn(async () => true)
		};

		const entry: DateEntry = {
			date: "2026-04-10",
			file: file.path,
			blockStart: 0,
			blockEnd: 0,
			summary: "",
			source: "namedate"
		};

		const canvas: any = {
			plugin,
			canvas: {
				style: {},
				getBoundingClientRect: () => ({ left: 50, top: 50, right: 500, bottom: 500 })
			},
			getToday: () => dropped,
			getDateForIndex: () => dropped,
			draw: vi.fn(),
			clearHover: vi.fn(),
			entryDragActive: true,
			entryDragEntry: entry,
			entryDragTargetDayIndex: 0
		};

		await commitAnchorEntryDrag(canvas as any);

		expect(vault.rename).not.toHaveBeenCalled();
		expect(plugin.setYamlDateForPath).not.toHaveBeenCalled();
	});

	it("renames compact YYYYMMDD filenames on drag-drop", async () => {
		const dropped = new Date("2026-05-19T12:00:00.000Z");
		const dateKey = resolveDateKeyForCanvasDrop(dropped);

		const file = makeFile("20260518.md");

		const vault = {
			getAbstractFileByPath: vi.fn((p: string) => {
				return String(p) === String(file.path) ? file : null;
			}),
			rename: vi.fn(async (_af: any, newPath: string) => {
				file.path = newPath;
				const parts = String(newPath).split("/");
				file.name = parts[parts.length - 1] ?? newPath;
				const dot = String(file.name).lastIndexOf(".");
				file.basename = dot >= 0 ? String(file.name).slice(0, dot) : String(file.name);
			})
		};

		const plugin: any = {
			app: { vault },
			setYamlDateForPath: vi.fn(async () => true)
		};

		const entry: DateEntry = {
			date: "2026-05-18",
			file: file.path,
			blockStart: 0,
			blockEnd: 0,
			summary: "",
			source: "namedate"
		};

		const canvas: any = {
			plugin,
			canvas: {
				style: {},
				getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100 })
			},
			getToday: () => dropped,
			getDateForIndex: () => dropped,
			draw: vi.fn(),
			clearHover: vi.fn(),
			entryDragActive: true,
			entryDragEntry: entry,
			entryDragTargetDayIndex: 0,
			entryDragLastClientX: 10,
			entryDragLastClientY: 10
		};

		await commitAnchorEntryDrag(canvas as any);

		expect(vault.rename).not.toHaveBeenCalled();
		expect(plugin.setYamlDateForPath).toHaveBeenCalledTimes(1);
		expect(String((plugin.setYamlDateForPath as any).mock.calls[0]?.[0] ?? "")).toBe(file.path);
		expect(String((plugin.setYamlDateForPath as any).mock.calls[0]?.[1] ?? "")).toBe(dateKey);
	});

	it("daily-note drag-drop keeps time tokens and changes only date", async () => {
		const dropped = new Date("2026-05-09T12:00:00.000Z");
		const dateKey = resolveDateKeyForCanvasDrop(dropped);

		const file = makeFile("daily/20260501112233444.md");

		const vault = {
			getAbstractFileByPath: vi.fn((p: string) => {
				return String(p) === String(file.path) ? file : null;
			}),
			createFolder: vi.fn(async () => {}),
			rename: vi.fn(async (_af: any, newPath: string) => {
				file.path = newPath;
				const parts = String(newPath).split("/");
				file.name = parts[parts.length - 1] ?? newPath;
				const dot = String(file.name).lastIndexOf(".");
				file.basename = dot >= 0 ? String(file.name).slice(0, dot) : String(file.name);
			})
		};

		const plugin: any = {
			app: { vault },
			getDailyNoteFolder: () => "daily",
			getDailyNoteFormat: () => "YYYYMMDDHHmmssSSS",
			setYamlDateForPath: vi.fn(async () => true)
		};

		const prevWindow = (globalThis as any).window;
		const moment = ((input?: any, fmt?: any, strict?: any) => {
			const parse = (raw: string) => {
				const m = /^([0-9]{4})([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{2})([0-9]{3})$/.exec(raw);
				return {
					isValid: () => !!m,
					year: () => Number(m?.[1] ?? NaN),
					month: () => Number(m?.[2] ?? NaN) - 1,
					date: () => Number(m?.[3] ?? NaN),
					format: (_f: string) => ""
				};
			};
			if (typeof input === "string" && fmt === "YYYYMMDDHHmmssSSS" && strict === true) {
				return parse(input);
			}
			return {
				isValid: () => false,
				year: () => NaN,
				month: () => NaN,
				date: () => NaN,
				format: (_f: string) => ""
			};
		}) as any;
		moment.utc = moment;
		(globalThis as any).window = { ...(prevWindow ?? {}), moment };

		const entry: DateEntry = {
			date: "2026-05-01",
			file: file.path,
			blockStart: 0,
			blockEnd: 0,
			summary: "",
			source: "namedate"
		};

		const canvas: any = {
			plugin,
			canvas: {
				style: {},
				getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100 })
			},
			getToday: () => dropped,
			getDateForIndex: () => dropped,
			draw: vi.fn(),
			clearHover: vi.fn(),
			entryDragActive: true,
			entryDragEntry: entry,
			entryDragTargetDayIndex: 0,
			entryDragLastClientX: 10,
			entryDragLastClientY: 10
		};

		try {
			await commitAnchorEntryDrag(canvas as any);
		} finally {
			(globalThis as any).window = prevWindow;
		}

		expect(vault.rename).toHaveBeenCalledTimes(1);
		const renamedTo = String((vault.rename as any).mock.calls[0]?.[1] ?? "");
		expect(renamedTo).toBe("daily/20260509112233444.md");

		expect(plugin.setYamlDateForPath).toHaveBeenCalledTimes(1);
		expect(String((plugin.setYamlDateForPath as any).mock.calls[0]?.[0] ?? "")).toBe(renamedTo);
		expect(String((plugin.setYamlDateForPath as any).mock.calls[0]?.[1] ?? "")).toBe(dateKey);
	});

	it("daily-note drag-drop renames with lowercase date format tokens", async () => {
		const dropped = new Date("2026-05-19T12:00:00.000Z");
		const dateKey = resolveDateKeyForCanvasDrop(dropped);

		const file = makeFile("daily/2026-05-22.md");

		const vault = {
			getAbstractFileByPath: vi.fn((p: string) => {
				return String(p) === String(file.path) ? file : null;
			}),
			createFolder: vi.fn(async () => {}),
			rename: vi.fn(async (_af: any, newPath: string) => {
				file.path = newPath;
				const parts = String(newPath).split("/");
				file.name = parts[parts.length - 1] ?? newPath;
				const dot = String(file.name).lastIndexOf(".");
				file.basename = dot >= 0 ? String(file.name).slice(0, dot) : String(file.name);
			})
		};

		const plugin: any = {
			app: { vault },
			getDailyNoteFolder: () => "daily",
			getDailyNoteFormat: () => "yyyy-MM-dd",
			setYamlDateForPath: vi.fn(async () => true)
		};

		const entry: DateEntry = {
			date: "2026-05-22",
			file: file.path,
			blockStart: 0,
			blockEnd: 0,
			summary: "",
			source: "namedate"
		};

		const canvas: any = {
			plugin,
			canvas: {
				style: {},
				getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100 })
			},
			getToday: () => dropped,
			getDateForIndex: () => dropped,
			draw: vi.fn(),
			clearHover: vi.fn(),
			entryDragActive: true,
			entryDragEntry: entry,
			entryDragTargetDayIndex: 0,
			entryDragLastClientX: 10,
			entryDragLastClientY: 10
		};

		await commitAnchorEntryDrag(canvas as any);

		expect(vault.rename).not.toHaveBeenCalled();
		expect(plugin.setYamlDateForPath).toHaveBeenCalledTimes(1);
		expect(String((plugin.setYamlDateForPath as any).mock.calls[0]?.[0] ?? "")).toBe(file.path);
		expect(String((plugin.setYamlDateForPath as any).mock.calls[0]?.[1] ?? "")).toBe(dateKey);
	});

	it("preserves AI summaries during drag-and-drop", async () => {
		const dropped = new Date("2026-05-19T12:00:00.000Z");
		const dateKey = resolveDateKeyForCanvasDrop(dropped);

		const file = makeFile("2026-05-18.md");

		const vault = {
			getAbstractFileByPath: vi.fn((p: string) => {
				return String(p) === String(file.path) ? file : null;
			}),
			rename: vi.fn(async (_af: any, newPath: string) => {
				file.path = newPath;
				const parts = String(newPath).split("/");
				file.name = parts[parts.length - 1] ?? newPath;
				const dot = String(file.name).lastIndexOf(".");
				file.basename = dot >= 0 ? String(file.name).slice(0, dot) : String(file.name);
			})
		};

		const plugin: any = {
			app: { vault },
			setYamlDateForPath: vi.fn(async () => true),
			refreshEpochViews: vi.fn()
		};

		const entry: DateEntry = {
			date: "2026-05-18",
			file: file.path,
			blockStart: 0,
			blockEnd: 0,
			summary: "",
			source: "namedate"
		};

		const canvas: any = {
			plugin,
			canvas: {
				style: {},
				getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100 })
			},
			getToday: () => dropped,
			getDateForIndex: () => dropped,
			draw: vi.fn(),
			clearHover: vi.fn(),
			entryDragActive: true,
			entryDragEntry: entry,
			entryDragTargetDayIndex: 0,
			entryDragLastClientX: 10,
			entryDragLastClientY: 10
		};

		await commitAnchorEntryDrag(canvas as any);

		expect(vault.rename).toHaveBeenCalledTimes(1);
		const renamedTo = String((vault.rename as any).mock.calls[0]?.[1] ?? "");
		expect(renamedTo).toBe(`${dateKey}.md`);

		expect(plugin.setYamlDateForPath).toHaveBeenCalledTimes(1);
		expect(String((plugin.setYamlDateForPath as any).mock.calls[0]?.[0] ?? "")).toBe(renamedTo);
		expect(String((plugin.setYamlDateForPath as any).mock.calls[0]?.[1] ?? "")).toBe(dateKey);
		expect(plugin.refreshEpochViews).not.toHaveBeenCalled();
	});
});
