import { describe, expect, it } from "vitest";
import { exclusionMethods } from "../src/plugin/exclusions";

function makePlugin(vaultOverrides: Partial<any> = {}, pluginOverrides: Partial<any> = {}): any {
	const vault = {
		getConfig: (_key: string) => undefined,
		configDir: "config",
		config: {},
		...vaultOverrides
	};

	const plugin: any = {
		app: { vault },
		excludedFiltersInitialized: false,
		excludedFiltersSignature: "",
		excludedFilterMatchers: [],
		indexReady: false,
		indexLoadPromise: null,
		indexFilePath: `${vault.configDir}/plugins/epochgram/index.json`,
		dataFilePath: `${vault.configDir}/plugins/epochgram/data.json`,
		pluginDirPath: `${vault.configDir}/plugins/epochgram`,
		...pluginOverrides
	};

	Object.assign(plugin, exclusionMethods);
	return plugin;
}

describe("Obsidian config ignored/excluded paths", () => {
	it("collects ignore filters from multiple config locations", () => {
		const plugin = makePlugin({
			getConfig: (key: string) => (key === "userIgnoreFilters" ? "b\na\n" : undefined),
			config: {
				userIgnoreFilters: ["c"],
				file: { excludedFolders: ["Ignored"], excludedFiles: ["^secret\\.md$"] }
			}
		});

		const out = plugin.getExcludedFilterStringsFromConfig();
		expect(out).toEqual(["Ignored", "^secret\\.md$", "a", "b", "c"]);
	});

	it("matches leaf-only patterns (anchors) against the filename", () => {
		const plugin = makePlugin({
			getConfig: () => undefined,
			config: { userIgnoreFilters: ["^secret\\.md$"] }
		});

		expect(plugin.isExcludedPath("Folder/secret.md")).toBe(true);
		expect(plugin.isExcludedPath("Folder/not-secret.md")).toBe(false);
	});

	it("falls back to escaped regex when a pattern is invalid", () => {
		const plugin = makePlugin({
			getConfig: () => undefined,
			config: { userIgnoreFilters: ["("] }
		});

		plugin.refreshExcludedMatchers();
		expect(plugin.excludedFilterMatchers.length).toBe(1);
		expect(plugin.isExcludedPath("Folder/(.md")).toBe(true);
	});

	it("shouldIndexPath returns false for excluded paths", () => {
		const plugin = makePlugin({
			getConfig: () => undefined,
			config: { userIgnoreFilters: ["^secret\\.md$"] }
		});

		expect(plugin.shouldIndexPath("Folder/secret.md")).toBe(false);
		expect(plugin.shouldIndexPath("Folder/ok.md")).toBe(true);
	});

	it("shouldIndexPath includes HTML attachments", () => {
		const plugin = makePlugin({
			getConfig: () => undefined,
			config: { userIgnoreFilters: [] }
		});

		expect(plugin.shouldIndexPath("page.html")).toBe(true);
		expect(plugin.shouldIndexPath("Daily/page.html")).toBe(true);
	});
});
