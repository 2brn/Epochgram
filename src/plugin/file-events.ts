import { MarkdownView, TFile, TFolder } from "obsidian";
import type { EpochPlugin } from "../main";
import { computeTextHash } from "../utils";
import { normalizeSnapshotValue } from "../indexer/snapshot-helpers";

type PendingOperation = ({ kind: "update"; path: string; force: boolean } | { kind: "delete"; path: string; folder: boolean } | { kind: "rename"; path: string; oldPath: string; folder: boolean }) & { attempts?: number };
export interface FileEventMethods { registerFileEvents(): void; }
export const fileEventMethods: FileEventMethods = {
	registerFileEvents(this: EpochPlugin): void {
		for (const ref of this.vaultEventRefs) this.app.vault.offref(ref);
		for (const ref of this.workspaceEventRefs) this.app.workspace.offref(ref);
		for (const ref of this.metadataEventRefs) this.app.metadataCache.offref(ref);
		this.vaultEventRefs = []; this.workspaceEventRefs = []; this.metadataEventRefs = [];
		const pending: PendingOperation[] = [];
		let timer: number | null = null;
		let running = false;
		let disposed = false;
		let dirty = false;
		let persistFailures = 0;
		const update = async (path: string, force: boolean): Promise<boolean> => {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile) || !this.shouldIndexFile(file)) {
				const known = this.indexer.isFileKnown(path);
				this.indexer.removeFile(path);
				return known;
			}
			const previous = this.indexer.getFileIndexData(path);
			const editor = this.app.workspace.getActiveViewOfType?.(MarkdownView);
			// Disk stats/hashes cannot detect an unsaved active-editor change.
			const liveEditor = editor?.file?.path === path;
			if (!force && !liveEditor && previous) {
				if (previous.indexedMtimeMs === file.stat.mtime && previous.indexedSize === file.stat.size) return false;
				if (previous.contentHash && ["md", "txt", "markdown", "mdown", "mkd", "mdx"].includes(file.extension.toLowerCase())) {
					const content = await this.app.vault.read(file);
					if (computeTextHash(normalizeSnapshotValue(content) ?? "") === previous.contentHash) return false;
				}
			}
			await this.indexer.processFile(file, { reason: "modify" });
			return true;
		};
		const schedule = () => {
			if (disposed || timer != null || running) return;
			timer = window.setTimeout(() => { void flush(); }, Math.min(30000, 900 * 2 ** persistFailures));
		};
		const flush = async () => {
			timer = null;
			if (running || disposed) return;
			running = true;
			let changed = false;
			const retry: PendingOperation[] = [];
			try {
				await this.ensureIndexLoaded();
				await this.waitForExcludedSync();
				if (disposed || !this.indexReady) return;
				for (let count = 0; count < 50 && pending.length && !disposed; count++) {
					const operation = pending.shift()!;
					try {
						if (operation.kind === "update") changed = await update(operation.path, operation.force) || changed;
						else if (operation.kind === "delete") {
							for (const path of this.indexer.getIndexedPaths()) if (path === operation.path || operation.folder && path.startsWith(`${operation.path}/`)) { this.indexer.removeFile(path); changed = true; }
						} else {
							const paths = operation.folder ? this.indexer.getIndexedPaths().filter(path => path.startsWith(`${operation.oldPath}/`)) : [operation.oldPath];
							for (const oldPath of paths) {
								const path = `${operation.path}${oldPath.slice(operation.oldPath.length)}`;
								const file = this.app.vault.getAbstractFileByPath(path);
								if (file instanceof TFile && this.shouldIndexFile(file)) await this.indexer.renameFile(oldPath, path);
								else this.indexer.removeFile(oldPath);
								changed = true;
							}
							if (operation.folder) for (const file of this.app.vault.getFiles()) {
								if (file.path.startsWith(`${operation.path}/`) && !this.indexer.isFileKnown(file.path) && this.shouldIndexFile(file)) changed = await update(file.path, true) || changed;
							}
						}
					} catch (error) {
						operation.attempts = (operation.attempts ?? 0) + 1;
						if (operation.attempts < 3) retry.push(operation);
						console.error("Epochgram: File update failed", operation.path, error);
					}
				}
				dirty ||= changed;
				if (dirty) {
					// Already-applied changes must be saved even if unload happened during a read.
					await this.persist({ skipEnsure: true });
					dirty = false; persistFailures = 0;
					if (!disposed) {
						this.scheduleInheritedMarkRecompute("files");
						this.refreshEpochViews({ forceRelated: true });
					}
				}
			} catch (error) { persistFailures = Math.min(6, persistFailures + 1); console.error("Epochgram: File event batch failed", error); }
			finally { if (!disposed) pending.push(...retry); running = false; if (pending.length || dirty) schedule(); }
		};
		const enqueue = (operation: PendingOperation) => {
			if (disposed) return;
			const previous = pending[pending.length - 1];
			if (operation.kind === "update" && previous?.kind === "update" && previous.path === operation.path) previous.force ||= operation.force;
			else pending.push(operation);
			schedule();
		};
		const managed = (path: string): boolean => {
			const type = this.getManagedFileType(path);
			if (!type) return false;
			void this.pollExternalIndexChanges({ forceIndex: type === "index", forceData: type === "data" }).catch(error => console.error("Epochgram: Cache update failed", error));
			return true;
		};
		const vault = this.app.vault;
		this.vaultEventRefs.push(vault.on("create", file => { if (file instanceof TFile && !managed(file.path)) enqueue({ kind: "update", path: file.path, force: true }); }));
		this.vaultEventRefs.push(vault.on("modify", file => { if (file instanceof TFile && !managed(file.path)) enqueue({ kind: "update", path: file.path, force: false }); }));
		this.vaultEventRefs.push(vault.on("delete", file => { if (!managed(file.path)) enqueue({ kind: "delete", path: file.path, folder: file instanceof TFolder }); }));
		this.vaultEventRefs.push(vault.on("rename", (file, oldPath) => { if (!managed(file.path) && !managed(oldPath)) enqueue({ kind: "rename", path: file.path, oldPath, folder: file instanceof TFolder }); }));
		this.metadataEventRefs.push(this.app.metadataCache.on("changed", file => { if (!managed(file.path)) enqueue({ kind: "update", path: file.path, force: true }); }));
		this.workspaceEventRefs.push(this.app.workspace.on("editor-change", (_editor, info) => { if (info.file) enqueue({ kind: "update", path: info.file.path, force: true }); }));
		for (const ref of [...this.vaultEventRefs, ...this.metadataEventRefs, ...this.workspaceEventRefs]) this.registerEvent(ref);
		this.register(() => { disposed = true; if (timer != null) window.clearTimeout(timer); pending.length = 0; });
	}
};
