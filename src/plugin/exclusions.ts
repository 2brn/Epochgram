import { normalizePath, TFile } from "obsidian";
import type { EpochPlugin } from "../main";

type PluginDataPaths = {
	vectorsFilePath?: string;
	termSimilarityFilePath?: string;
};

type VaultConfigLike = {
	getConfig?: (key: string) => unknown;
	config?: {
		userIgnoreFilters?: unknown;
		file?: {
			excludedFolders?: unknown;
			excludedFiles?: unknown;
		};
	};
};

export interface ExclusionMethods {
	isPluginDataFile(path: string): boolean;
	getManagedFileType(path: string): "index" | "data" | "vectors" | "termSimilarity" | null;
	shouldIndexFile(file: TFile): boolean;
	shouldIndexPath(path: string): boolean;
	isExcludedPath(path: string): boolean;
	refreshExcludedMatchers(): boolean;
	compileExcludedMatchers(filters: string[]): RegExp[];
	getExcludedFilterStringsFromConfig(): string[];
	collectFiltersFromConfig(value: unknown, target: Set<string>): void;
	ensureExcludedSync(): Promise<void>;
	waitForExcludedSync(): Promise<void>;
	getFileName(path: string): string;
}

export const exclusionMethods: ExclusionMethods = {
	isPluginDataFile(this: EpochPlugin, path: string): boolean {
		const normalized = normalizePath(path);
		const pluginData = this as EpochPlugin & PluginDataPaths;
		if (normalized === this.indexFilePath) return true;
		if (normalized === normalizePath(String(pluginData.vectorsFilePath || ""))) return true;
		if (normalized === normalizePath(String(pluginData.termSimilarityFilePath || ""))) return true;
		return normalized.startsWith(`${this.pluginDirPath}/`);
	},

	getManagedFileType(this: EpochPlugin, path: string): "index" | "data" | "vectors" | "termSimilarity" | null {
		const normalized = normalizePath(path);
		const pluginData = this as EpochPlugin & PluginDataPaths;
		if (normalized === this.indexFilePath) return "index";
		if (normalized === this.dataFilePath) return "data";
		if (normalized === normalizePath(String(pluginData.vectorsFilePath || ""))) return "vectors";
		if (normalized === normalizePath(String(pluginData.termSimilarityFilePath || ""))) return "termSimilarity";
		return null;
	},

	shouldIndexFile(this: EpochPlugin, file: TFile): boolean {
		return this.shouldIndexPath(file.path);
	},

	shouldIndexPath(this: EpochPlugin, path: string): boolean {
		if (!path) return false;
		if (this.isPluginDataFile(path)) return false;
		return !this.isExcludedPath(path);
	},

	isExcludedPath(this: EpochPlugin, path: string): boolean {
		if (!path) return false;
		if (!this.excludedFiltersInitialized) {
			this.refreshExcludedMatchers();
		}
		if (this.excludedFilterMatchers.length === 0) return false;
		for (const matcher of this.excludedFilterMatchers) {
			if (matcher.test(path)) return true;
			const leaf = this.getFileName(path);
			if (leaf && matcher.test(leaf)) return true;
		}
		return false;
	},

	refreshExcludedMatchers(this: EpochPlugin): boolean {
		const filters = this.getExcludedFilterStringsFromConfig();
		const signature = filters.join("\n");
		const changed = this.excludedFiltersSignature !== signature;
		this.excludedFiltersInitialized = true;
		if (!changed) {
			return false;
		}
		this.excludedFiltersSignature = signature;
		this.excludedFilterMatchers = this.compileExcludedMatchers(filters);
		if (this.indexReady || this.indexLoadPromise) {
			void this.ensureExcludedSync();
		}
		return true;
	},

	compileExcludedMatchers(_filters: string[]): RegExp[] {
		const filters = _filters;
		const result: RegExp[] = [];
		for (const raw of filters) {
			const pattern = raw.trim();
			if (!pattern) continue;
			try {
				result.push(new RegExp(pattern, "i"));
				continue;
			} catch {
				// fall through to escaped version
			}
			const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			try {
				result.push(new RegExp(escaped, "i"));
			} catch {
				void pattern;
			}
		}
		return result;
	},

	getExcludedFilterStringsFromConfig(this: EpochPlugin): string[] {
		const collected = new Set<string>();
		const vaultConfig = this.app.vault as unknown as VaultConfigLike;
		this.collectFiltersFromConfig(vaultConfig.getConfig?.("userIgnoreFilters"), collected);
		this.collectFiltersFromConfig(vaultConfig.config?.userIgnoreFilters, collected);
		this.collectFiltersFromConfig(vaultConfig.config?.file?.excludedFolders, collected);
		this.collectFiltersFromConfig(vaultConfig.config?.file?.excludedFiles, collected);
		return Array.from(collected)
			.filter(Boolean)
			.map(item => item.trim())
			.filter(item => item.length > 0)
			.sort();
	},

	collectFiltersFromConfig(_value: unknown, target: Set<string>): void {
		const value = _value;
		if (!value) return;
		if (Array.isArray(value)) {
			for (const entry of value) {
				if (typeof entry !== "string") continue;
				const trimmed = entry.trim();
				if (trimmed) target.add(trimmed);
			}
			return;
		}
		if (typeof value === "string") {
			for (const line of value.split(/\r?\n/)) {
				const trimmed = line.trim();
				if (trimmed) target.add(trimmed);
			}
		}
	},

	async ensureExcludedSync(this: EpochPlugin): Promise<void> {
		if (this.excludedSyncInFlight) {
			return this.excludedSyncInFlight;
		}
		this.excludedSyncInFlight = (async () => {
			try {
				await this.ensureIndexLoaded();
				if (!this.indexReady) return;
				if (this.excludedFilterMatchers.length === 0) return;
				const indexedPaths = this.indexer.getIndexedPaths();
				const toRemove: string[] = [];
				for (const path of indexedPaths) {
					if (this.isPluginDataFile(path)) continue;
					if (this.isExcludedPath(path)) {
						toRemove.push(path);
					}
				}
				if (toRemove.length === 0) return;
				const changed = this.removePathsFromIndex(toRemove);
				if (!changed) return;
				await this.persist({ skipEnsure: true });
				this.refreshEpochViews();
			} catch (error) {
				void error;
			} finally {
				this.excludedSyncInFlight = null;
			}
		})();
		return this.excludedSyncInFlight;
	},

	async waitForExcludedSync(this: EpochPlugin): Promise<void> {
		if (!this.excludedSyncInFlight) return;
		try {
			await this.excludedSyncInFlight;
		} catch (error) {
			void error;
		}
	},

	getFileName(_path: string): string {
		const path = _path;
		const idx = path.lastIndexOf("/");
		return idx >= 0 ? path.slice(idx + 1) : path;
	}
};
