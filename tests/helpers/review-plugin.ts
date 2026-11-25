import { vi } from "vitest";
import { TFile } from "obsidian";
import { Indexer } from "../../src/indexer/indexer";
import { TimelineSearchIndex } from "../../src/search/timeline-search-index";
import { indexingMethods } from "../../src/plugin/indexing";
import { reviewMethods } from "../../src/plugin/reviews";
import { DEFAULT_SETTINGS } from "../../src/settings-model";

export async function makeReviewPlugin(initial: Record<string, string> = { "note.md": "Body" }): Promise<any> {
	const contents = { ...initial }, stored = new Map<string, string>();
	const files = Object.keys(contents).map(path => {
		const name = path.split("/").pop()!;
		return new (TFile as any)(path, { basename: name.slice(0, name.lastIndexOf(".")), extension: name.split(".").pop(), stat: { ctime: Date.UTC(2026, 0, 1), mtime: Date.UTC(2026, 0, 1), size: 100 } });
	});
	const plugin: any = {
		contents, stored, files, settings: structuredClone(DEFAULT_SETTINGS), viewPreferences: { showAttachments: true, showParsed: true },
		indexReady: false, indexLoadPromise: null, pluginDirPath: "config/plugins/epochgram", indexFilePath: "config/plugins/epochgram/index.json", dataFilePath: "config/plugins/epochgram/data.json",
		indexFileStat: { mtime: null, size: null }, dataFileStat: { mtime: null, size: null },
		timelineSearchIndex: new TimelineSearchIndex(),
		app: {
			vault: { configDir: "config", getFiles: () => files, getAbstractFileByPath: (path: string) => files.find(file => file.path === path),
				read: vi.fn(async (file: TFile) => contents[file.path] ?? ""), modify: vi.fn(), create: vi.fn(), delete: vi.fn(),
				adapter: { exists: vi.fn(async (path: string) => stored.has(path)), read: vi.fn(async (path: string) => stored.get(path) ?? ""),
					write: vi.fn(async (path: string, value: string) => { stored.set(path, value); }), remove: vi.fn(async (path: string) => { stored.delete(path); }), mkdir: vi.fn(async () => {}), stat: vi.fn(async (path: string) => ({ mtime: 1, size: (stored.get(path) ?? "").length })) }
			},
			metadataCache: { getFileCache: () => ({ frontmatter: {}, tags: [] }) },
			workspace: { getActiveViewOfType: vi.fn(), getLeavesOfType: () => [] }
		},
		refreshExcludedMatchers: vi.fn(), waitForExcludedSync: vi.fn(async () => {}), shouldIndexFile: () => true,
		persist: vi.fn(async () => {}), persistIndex: vi.fn(async () => {}), refreshEpochViews: vi.fn(), scheduleInheritedMarkRecompute: vi.fn(),
		refreshCalendarSyncSchedule: vi.fn(), clearInheritedMarksCache: vi.fn(), saveSettings: vi.fn(), ensureExcludedSync: vi.fn(),
		addStatusBarItem: () => ({ addClass() {}, addEventListener() {}, setAttribute() {}, style: { setProperty() {} } })
	};
	Object.assign(plugin, indexingMethods, reviewMethods);
	plugin.indexer = new Indexer(plugin);
	for (const file of files) await plugin.indexer.processFile(file, { reason: "create" });
	plugin.indexReady = true;
	return plugin;
}
