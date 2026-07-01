import { TAbstractFile, TFile } from "obsidian";
import type { EpochPlugin } from "../main";
import { markTimelineSearchIndexDirty, scheduleTimelineSearchCacheSave } from "./timeline-search-cache";
import { normalizeSnapshotValue } from "../indexer/snapshot-helpers";
import { computeTextHash } from "../utils";
import { isTrackChangesEffective } from "./pro-feature-state";

type FileIndexDataLike = {
	indexedMtimeMs?: number;
	indexedSize?: number;
	contentHash?: string;
};

type TimelineSearchIndexLike = {
	removeById?: (id: string) => boolean;
};

type FileEventPluginState = EpochPlugin & {
	__epochDeferredIndexResync?: Set<string>;
	__epochDeferredIndexResyncForce?: Set<string>;
	__epochDeferredIndexResyncTimer?: number | null;
	timelineSearchIndex?: TimelineSearchIndexLike;
	maybeIndexOpenedFile?: (file: TFile) => Promise<void>;
	queueVectorUpdate?: (path: string) => void;
	queueTermSimilarityUpdate?: (path: string) => void;
	removeVector?: (path: string) => Promise<void>;
	removeTermSimilarity?: (path: string) => Promise<void>;
	renameVector?: (oldPath: string, newPath: string) => Promise<void>;
	renameTermSimilarity?: (oldPath: string, newPath: string) => Promise<void>;
};

function state(plugin: EpochPlugin): FileEventPluginState {
	return plugin;
}

function getIndexData(plugin: EpochPlugin, path: string): FileIndexDataLike | null {
	if (typeof plugin.indexer?.getFileIndexData !== "function") return null;
	const data = plugin.indexer.getFileIndexData(path) as unknown;
	if (!data || typeof data !== "object") return null;
	return data;
}

async function shouldSkipUnchangedModify(plugin: EpochPlugin, file: TFile, force: boolean): Promise<boolean> {
	if (force) return false;
	if (typeof plugin.indexer?.isFileKnown !== "function" || !plugin.indexer.isFileKnown(file.path)) return false;

	try {
		const prev = getIndexData(plugin, file.path);
		const prevMtime = Number(prev?.indexedMtimeMs);
		const prevSize = Number(prev?.indexedSize);
		const curMtime = Number(file.stat.mtime);
		const curSize = Number(file.stat.size);
		if (
			Number.isFinite(prevMtime) && Number.isFinite(prevSize) &&
			Number.isFinite(curMtime) && Number.isFinite(curSize) &&
			prevMtime > 0 && prevSize >= 0 &&
			curMtime > 0 && curSize >= 0 &&
			prevMtime === curMtime && prevSize === curSize
		) {
			return true;
		}
	} catch {
		// ignore
	}

	try {
		const prev = getIndexData(plugin, file.path);
		const prevHash = typeof prev?.contentHash === "string" ? prev.contentHash.trim() : "";
		const ext = String(file.extension || "").toLowerCase();
		if (prevHash && ext && (ext === "md" || ext === "txt" || ext === "markdown" || ext === "mdown" || ext === "mkd" || ext === "mdx")) {
			const raw = await plugin.app.vault.read(file);
			const normalized = normalizeSnapshotValue(raw) ?? "";
			const curHash = computeTextHash(normalized);
			if (curHash === prevHash) {
				return true;
			}
		}
	} catch {
		// ignore
	}

	return false;
}

function deferIndexResync(plugin: EpochPlugin, path: string, options?: { force?: boolean }): void {
	try {
		const pluginState = state(plugin);
		if (!(pluginState.__epochDeferredIndexResync instanceof Set)) {
			pluginState.__epochDeferredIndexResync = new Set<string>();
		}
		pluginState.__epochDeferredIndexResync.add(String(path || ""));
		if (options?.force) {
			if (!(pluginState.__epochDeferredIndexResyncForce instanceof Set)) {
				pluginState.__epochDeferredIndexResyncForce = new Set<string>();
			}
			pluginState.__epochDeferredIndexResyncForce.add(String(path || ""));
		}
	} catch {
		// ignore
	}
	void scheduleDeferredIndexResync(plugin);
}

async function scheduleDeferredIndexResync(plugin: EpochPlugin): Promise<void> {
	const pluginState = state(plugin);
	try {
		if (pluginState.__epochDeferredIndexResyncTimer != null) return;
	} catch {
		// ignore
	}
	try {
		pluginState.__epochDeferredIndexResyncTimer = window.setTimeout(() => {
			try {
				pluginState.__epochDeferredIndexResyncTimer = null;
			} catch {
				// ignore
			}
			void flushDeferredIndexResync(plugin);
		}, 500);
	} catch {
		// ignore
	}
}

async function flushDeferredIndexResync(plugin: EpochPlugin): Promise<void> {
	const pluginState = state(plugin);
	let set: Set<string> | null = null;
	let forceSet: Set<string> | null = null;
	try {
		set = pluginState.__epochDeferredIndexResync ?? null;
		forceSet = pluginState.__epochDeferredIndexResyncForce ?? null;
	} catch {
		set = null;
		forceSet = null;
	}
	if (!(set instanceof Set) || set.size === 0) return;

	// If the index is still loading, keep deferring.
	if (plugin.indexLoadPromise || !plugin.indexReady) {
		void scheduleDeferredIndexResync(plugin);
		return;
	}

	const batch = Array.from(set).map((p) => String(p || "").trim()).filter(Boolean).slice(0, 50);
	for (const p of batch) {
		try {
			set.delete(p);
		} catch {
			// ignore
		}
	}

	let didSomething = false;
	try {
		await plugin.ensureIndexLoaded();
		await plugin.waitForExcludedSync();
		if (!plugin.indexReady) return;

		for (const p of batch) {
			try {
				const force = (() => {
					try {
						return forceSet instanceof Set && forceSet.has(p);
					} catch {
						return false;
					}
				})();
				try {
					if (forceSet instanceof Set) forceSet.delete(p);
				} catch {
					// ignore
				}

				const abs = plugin.app.vault.getAbstractFileByPath(p);
				if (abs instanceof TFile && plugin.shouldIndexFile(abs)) {
					if (await shouldSkipUnchangedModify(plugin, abs, force)) continue;
					await plugin.indexer.processFile(abs, { reason: "modify" });
					didSomething = true;
					continue;
				}
			} catch {
				// ignore
			}

			// Remove from index (and also from timeline search index even if the main index never had it).
			try {
				const removed = plugin.removePathsFromIndex([p]);
				if (removed) didSomething = true;
			} catch {
				// ignore
			}
			try {
				if (forceSet instanceof Set) forceSet.delete(p);
			} catch {
				// ignore
			}
			try {
				const timelineMutated = pluginState.timelineSearchIndex?.removeById?.(p) === true;
				if (timelineMutated) {
					markTimelineSearchIndexDirty(plugin);
					scheduleTimelineSearchCacheSave(plugin);
				}
			} catch {
				// ignore
			}
		}

		if (didSomething) {
			await plugin.persist({ skipEnsure: true });
			plugin.refreshEpochViews();
		}
	} finally {
		// If more work remains, schedule another flush.
		try {
			if (set.size > 0) void scheduleDeferredIndexResync(plugin);
		} catch {
			// ignore
		}
	}
}

export interface FileEventMethods {
	registerFileEvents(): void;
}

export const fileEventMethods: FileEventMethods = {
	registerFileEvents(this: EpochPlugin): void {
		for (const ref of this.vaultEventRefs) {
			this.app.vault.offref(ref);
		}
		for (const ref of this.workspaceEventRefs) {
			this.app.workspace.offref(ref);
		}
		for (const ref of this.metadataEventRefs) {
			this.app.metadataCache.offref(ref);
		}
		this.vaultEventRefs = [];
		this.workspaceEventRefs = [];
		this.metadataEventRefs = [];

		const createRef = this.app.vault.on("create", async (file: TAbstractFile) => {
			if (!(file instanceof TFile)) return;
			const managedType = this.getManagedFileType(file.path);
			if (managedType) {
				if (managedType === "index" || managedType === "data" || managedType === "vectors" || managedType === "termSimilarity") {
					await this.ensureIndexLoaded();
					await this.waitForExcludedSync();
					await this.pollExternalIndexChanges({
						forceIndex: managedType === "index",
						forceData: true,
						forceVectors: managedType === "vectors",
						forceTermSimilarity: managedType === "termSimilarity"
					});
				}
				return;
			}

			// During initial index load, Obsidian can emit many file events on large vaults.
			// Avoid queuing heavy work until the index is ready. Startup-created notes that are
			// opened will still be handled via the workspace file-open safeguard.
			if (this.indexLoadPromise || !this.indexReady) {
				try {
					const active = this.app.workspace.getActiveFile();
					if (active && active.path === file.path) {
						void state(this).maybeIndexOpenedFile?.(file);
					}
				} catch {
					// ignore
				}
				deferIndexResync(this, file.path);
				return;
			}
			await this.ensureIndexLoaded();
			await this.waitForExcludedSync();
			if (!this.shouldIndexFile(file)) {
				const removed = this.removePathsFromIndex([file.path]);
				if (removed) {
					await this.persist({ skipEnsure: true });
					this.refreshEpochViews();
				}
				return;
			}
			await this.indexer.processFile(file, { reason: "create" });
			await this.persist({ skipEnsure: true });
			try {
				state(this).queueVectorUpdate?.(file.path);
			} catch {
				// ignore
			}
			try {
				state(this).queueTermSimilarityUpdate?.(file.path);
			} catch {
				// ignore
			}
			this.refreshEpochViews();
		});
		this.registerEvent(createRef);
		this.vaultEventRefs.push(createRef);

		const deleteRef = this.app.vault.on("delete", async (file: TAbstractFile) => {
			if (!(file instanceof TFile)) return;
			const managedType = this.getManagedFileType(file.path);
			if (managedType) {
				if (managedType === "index" || managedType === "data" || managedType === "vectors" || managedType === "termSimilarity") {
					await this.ensureIndexLoaded();
					await this.waitForExcludedSync();
					await this.pollExternalIndexChanges({
						forceIndex: managedType === "index",
						forceData: true,
						forceVectors: managedType === "vectors",
						forceTermSimilarity: managedType === "termSimilarity"
					});
				}
				return;
			}
			if (this.indexLoadPromise || !this.indexReady) {
				deferIndexResync(this, file.path);
				return;
			}
			await this.ensureIndexLoaded();
			await this.waitForExcludedSync();
			this.indexer.removeFile(file.path);
			await this.persist({ skipEnsure: true });
			try {
				await state(this).removeVector?.(file.path);
			} catch {
				// ignore
			}
			try {
				await state(this).removeTermSimilarity?.(file.path);
			} catch {
				// ignore
			}
			this.refreshEpochViews();
		});
		this.registerEvent(deleteRef);
		this.vaultEventRefs.push(deleteRef);

		const renameRef = this.app.vault.on(
			"rename",
			async (file: TAbstractFile, oldPath: string) => {
				if (!(file instanceof TFile)) return;
				const newManagedType = this.getManagedFileType(file.path);
				const oldManagedType = this.getManagedFileType(oldPath);
				if (newManagedType || oldManagedType) {
					if (
						newManagedType === "index" ||
						oldManagedType === "index" ||
						newManagedType === "data" ||
						oldManagedType === "data" ||
						newManagedType === "vectors" ||
						oldManagedType === "vectors" ||
						newManagedType === "termSimilarity" ||
						oldManagedType === "termSimilarity"
					) {
						await this.ensureIndexLoaded();
						await this.waitForExcludedSync();
						await this.pollExternalIndexChanges({
							forceIndex: newManagedType === "index" || oldManagedType === "index",
							forceData: true,
							forceVectors: newManagedType === "vectors" || oldManagedType === "vectors",
							forceTermSimilarity: newManagedType === "termSimilarity" || oldManagedType === "termSimilarity"
						});
					}
					return;
				}
				if (this.indexLoadPromise || !this.indexReady) {
					deferIndexResync(this, oldPath);
					deferIndexResync(this, file.path);
					return;
				}
				await this.ensureIndexLoaded();
				await this.waitForExcludedSync();
				const newIndexable = this.shouldIndexFile(file);
				const oldIndexable = this.shouldIndexPath(oldPath);
				if (!newIndexable) {
					const removedAny = this.removePathsFromIndex([oldPath, file.path]);
					if (removedAny) {
						await this.persist({ skipEnsure: true });
						this.refreshEpochViews();
					}
					return;
				}
				if (!oldIndexable) {
					this.removePathsFromIndex([oldPath]);
					await this.indexer.processFile(file, { reason: "create" });
					await this.persist({ skipEnsure: true });
					this.refreshEpochViews();
					return;
				}
				await this.indexer.renameFile(oldPath, file.path);
				await this.persist({ skipEnsure: true });
				try {
					await state(this).renameVector?.(oldPath, file.path);
				} catch {
					// ignore
				}
				try {
					await state(this).renameTermSimilarity?.(oldPath, file.path);
				} catch {
					// ignore
				}
				try {
					// Path is part of the classification input; reclassify after rename.
					state(this).queueTermSimilarityUpdate?.(file.path);
				} catch {
					// ignore
				}
				this.refreshEpochViews();
			}
		);
		this.registerEvent(renameRef);
		this.vaultEventRefs.push(renameRef);

		if (isTrackChangesEffective(this)) {
			const handleTrackedChange = async (file: TFile) => {
				await this.ensureIndexLoaded();
				await this.waitForExcludedSync();
				if (!this.shouldIndexFile(file)) {
					const removed = this.removePathsFromIndex([file.path]);
					if (removed) {
						await this.persist({ skipEnsure: true });
						this.refreshEpochViews();
					}
					return;
				}
				await this.indexer.processFile(file, { reason: "track" });
				await this.persist({ skipEnsure: true });
				try {
					state(this).queueVectorUpdate?.(file.path);
				} catch {
					// ignore
				}
				try {
					state(this).queueTermSimilarityUpdate?.(file.path);
				} catch {
					// ignore
				}
				this.refreshEpochViews();
			};

			const trackRef = this.app.workspace.on(
				"editor-change",
				async (_editor, _info) => {
					const file = this.app.workspace.getActiveFile();
					if (!file) return;
					await handleTrackedChange(file);
				}
			);
			this.registerEvent(trackRef);
			this.workspaceEventRefs.push(trackRef);

			const trackModifyRef = this.app.vault.on("modify", async (file: TAbstractFile) => {
				if (!(file instanceof TFile)) return;
				await handleTrackedChange(file);
			});
			this.registerEvent(trackModifyRef);
			this.vaultEventRefs.push(trackModifyRef);
		} else {
			const modifyRef = this.app.vault.on("modify", async (file: TAbstractFile) => {
				if (!(file instanceof TFile)) return;
				if (this.indexLoadPromise || !this.indexReady) {
					try {
						const active = this.app.workspace.getActiveFile();
						if (active && active.path === file.path) {
							void state(this).maybeIndexOpenedFile?.(file);
						}
					} catch {
						// ignore
					}
					deferIndexResync(this, file.path);
					return;
				}
				await this.ensureIndexLoaded();
				await this.waitForExcludedSync();
				if (!this.shouldIndexFile(file)) {
					const removed = this.removePathsFromIndex([file.path]);
					if (removed) {
						await this.persist({ skipEnsure: true });
						this.refreshEpochViews();
					}
					return;
				}
				if (await shouldSkipUnchangedModify(this, file, false)) return;
				await this.indexer.processFile(file, { reason: "modify" });
				await this.persist({ skipEnsure: true });
				try {
					state(this).queueVectorUpdate?.(file.path);
				} catch {
					// ignore
				}
				try {
					state(this).queueTermSimilarityUpdate?.(file.path);
				} catch {
					// ignore
				}
				this.refreshEpochViews();
			});
			this.registerEvent(modifyRef);
			this.vaultEventRefs.push(modifyRef);
		}

		const pluginModifyRef = this.app.vault.on("modify", async (file: TAbstractFile) => {
			if (!(file instanceof TFile)) return;
			const managedType = this.getManagedFileType(file.path);
			if (!managedType) return;
			if (managedType === "vectors") {
				await this.ensureIndexLoaded();
				await this.waitForExcludedSync();
				await this.pollExternalIndexChanges({
					forceVectors: true,
					forceData: true
				});
				return;
			}
			if (managedType === "termSimilarity") {
				await this.ensureIndexLoaded();
				await this.waitForExcludedSync();
				await this.pollExternalIndexChanges({
					forceTermSimilarity: true,
					forceData: true
				});
				return;
			}
			await this.ensureIndexLoaded();
			await this.waitForExcludedSync();
			await this.pollExternalIndexChanges({
				forceIndex: managedType === "index",
				forceData: true
			});
		});
		this.registerEvent(pluginModifyRef);
		this.vaultEventRefs.push(pluginModifyRef);

		const metaChangedRef = this.app.metadataCache.on(
			"changed",
			async (file: TFile) => {
				try {
					if (!(file instanceof TFile)) return;
					const active = this.app.workspace.getActiveFile();
					if (!active || active.path !== file.path) return;
					deferIndexResync(this, file.path);
					this.refreshEpochViews({ forceSemanticRelated: true });
				} catch {
					// ignore
				}
			}
		);
		this.registerEvent(metaChangedRef);
		this.metadataEventRefs.push(metaChangedRef);
	}
};
