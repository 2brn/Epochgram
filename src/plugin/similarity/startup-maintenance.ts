import { Platform, TFile } from "obsidian";
import type { EpochPlugin } from "../../main";
import { embeddingsSimilarityEnabled, isTopicSimilarityEnabled } from "./config";
import { readStore } from "./store";
import { readTermStore } from "../similarity-term-store";
import { getEmbeddingTermForPath, getTermVocabulary } from "./topic";
import { isLikelyTextFileExtension } from "../../utils";
import { sleep } from "./time";
import { sortFilesNewestRecordFirst } from "./files";
import { hasSimilarityAccess } from "../pro-feature-state";

type SimilarityRuntime = {
	__epochHugeSimilarityBackfillTimer?: number | null;
	__epochHugeSimilarityBackfillRunning?: boolean;
	__epochHugeVectorsQueuedAll?: boolean;
	__epochHugeSimilarityBackfillFiles?: TFile[] | null;
	__epochHugeSimilarityBackfillIndex?: number;
	__epochDidSimilarityStartupMaintenance?: boolean;
	termSimilarityPendingFiles?: Set<string>;
	queueVectorUpdate?: (path: string) => void;
	queueTermSimilarityUpdate?: (path: string) => void;
	ensureTermSimilarityStoreLoaded?: () => Promise<void>;
};

type VectorRecord = { h?: string; v?: unknown[] };
type TopicRecord = { term?: string; h?: string; vocabularySig?: string };
type VectorStoreLike = { files?: Record<string, VectorRecord> };
type TopicStoreLike = { files?: Record<string, TopicRecord> };

function isVitestEnv(): boolean {
	try {
		const env = (window as unknown as { process?: { env?: Record<string, unknown> } }).process?.env;
		return env?.VITEST != null;
	} catch {
		return false;
	}
}

function getLowerFileExtension(file: unknown): string {
	const fileLike = (file as { extension?: unknown; path?: unknown }) ?? {};
	const ext = typeof fileLike.extension === "string" ? fileLike.extension.trim() : "";
	if (ext) return ext.toLowerCase();
	const p = typeof fileLike.path === "string" ? fileLike.path : "";
	const lastDot = p.lastIndexOf(".");
	if (lastDot <= -1) return "";
	return p.slice(lastDot + 1).toLowerCase();
}

function scheduleHugeVaultSimilarityBackfill(plugin: EpochPlugin, delayMs: number): void {
	const runtime = plugin as unknown as SimilarityRuntime;
	try {
		if (runtime.__epochHugeSimilarityBackfillTimer != null) return;
	} catch { void 0; }
	try {
		runtime.__epochHugeSimilarityBackfillTimer = window.setTimeout(() => {
			try {
				runtime.__epochHugeSimilarityBackfillTimer = null;
			} catch { void 0; }
			void runHugeVaultSimilarityBackfillTick(plugin);
		}, Math.max(0, Math.floor(delayMs)));
	} catch { void 0; }
}

async function runHugeVaultSimilarityBackfillTick(plugin: EpochPlugin): Promise<void> {
	const runtime = plugin as unknown as SimilarityRuntime;
	try {
		if (runtime.__epochHugeSimilarityBackfillRunning) return;
		runtime.__epochHugeSimilarityBackfillRunning = true;
	} catch { void 0; }
	try {
		try {
				if (!hasSimilarityAccess(plugin)) return;
		} catch {
			return;
		}

		const vectorsEnabled = embeddingsSimilarityEnabled(plugin);
		const topicsEnabled = isTopicSimilarityEnabled(plugin);
		if (!vectorsEnabled && !topicsEnabled) return;

		const vectorsQueuedAll = (() => {
			try {
				return runtime.__epochHugeVectorsQueuedAll === true;
			} catch {
				return false;
			}
		})();

		const files: TFile[] = Array.isArray(runtime.__epochHugeSimilarityBackfillFiles)
			? runtime.__epochHugeSimilarityBackfillFiles
			: (runtime.__epochHugeSimilarityBackfillFiles = sortFilesNewestRecordFirst(
				plugin,
				plugin.app.vault
					.getFiles()
					.filter((f) => {
						try {
							if (!f) return false;
							if (!(f instanceof TFile)) return false;
							if (!plugin.shouldIndexFile(f)) return false;
							const ext = getLowerFileExtension(f);
							return isLikelyTextFileExtension(ext);
						} catch {
							return false;
						}
					})
			));
		if (!Array.isArray(files) || files.length === 0) return;

		const nextIndexRaw = Number(runtime.__epochHugeSimilarityBackfillIndex ?? 0);
		let nextIndex = Number.isFinite(nextIndexRaw) ? Math.max(0, Math.floor(nextIndexRaw)) : 0;
		if (nextIndex >= files.length) {
			runtime.__epochHugeSimilarityBackfillFiles = null;
			runtime.__epochHugeSimilarityBackfillIndex = 0;
			return;
		}

		const topicPending = (() => {
			try {
				return runtime.termSimilarityPendingFiles instanceof Set ? runtime.termSimilarityPendingFiles.size : 0;
			} catch {
				return 0;
			}
		})();
		if (topicPending > 2000) {
			scheduleHugeVaultSimilarityBackfill(plugin, 10_000);
			return;
		}

		const SCAN_PER_TICK = 250;
		const MAX_ENQUEUE_TOPICS_PER_TICK = 100;

			let store: VectorStoreLike | null = null;
			let termStore: TopicStoreLike | null = null;
		let vocab: { terms: string[]; sig: string } | null = null;
		let enqTopics = 0;

		let scanned = 0;
		for (; nextIndex < files.length && scanned < SCAN_PER_TICK; nextIndex++) {
			scanned++;
			const f = files[nextIndex];
			const p = String(f.path ?? "").trim();
			if (!p) continue;
			const ext = getLowerFileExtension(f);
			try {
				if (!plugin.shouldIndexFile(f)) continue;
			} catch { void 0; }
			try {
				if (!isLikelyTextFileExtension(ext)) continue;
			} catch { void 0; }

			if (!vectorsQueuedAll && vectorsEnabled) {
				try {
					if (!store) store = await readStore(plugin);
					const existing = store.files?.[p];
					const hasHash = typeof existing?.h === "string" && existing.h.trim().length > 0;
					const hasVector = Array.isArray(existing?.v);
					if (!(hasHash && hasVector)) {
						runtime.queueVectorUpdate?.(p);
					}
				} catch { void 0; }
			}

			if (topicsEnabled && enqTopics < MAX_ENQUEUE_TOPICS_PER_TICK && ext === "md") {
				try {
					const explicit = String(getEmbeddingTermForPath(plugin, p) || "").trim();
					if (explicit) continue;
				} catch { void 0; }
				try {
					if (!vocab) vocab = getTermVocabulary(plugin);
					if (!vocab.terms || vocab.terms.length === 0) {
						continue;
					}
					if (!termStore) termStore = await readTermStore(plugin);
					const rec = termStore.files?.[p];
					const termOk = typeof rec?.term === "string" && rec.term.trim().length > 0;
					const hashOk = typeof rec?.h === "string" && rec.h.trim().length > 0;
					const vocabOk = typeof rec?.vocabularySig === "string" && rec.vocabularySig === vocab.sig;
					if (!(termOk && hashOk && vocabOk)) {
						runtime.queueTermSimilarityUpdate?.(p);
						enqTopics++;
					}
				} catch { void 0; }
			}

			if ((nextIndex + 1) % 50 === 0) {
				await sleep(0);
			}

			if (enqTopics >= MAX_ENQUEUE_TOPICS_PER_TICK) {
				nextIndex++;
				break;
			}
		}

		runtime.__epochHugeSimilarityBackfillIndex = nextIndex;
		if (nextIndex >= files.length) {
			runtime.__epochHugeSimilarityBackfillFiles = null;
			runtime.__epochHugeSimilarityBackfillIndex = 0;
			return;
		}

		const isTestEnv = isVitestEnv();
		scheduleHugeVaultSimilarityBackfill(plugin, isTestEnv ? 0 : Platform.isMobile ? 2000 : 250);
	} finally {
		try {
			runtime.__epochHugeSimilarityBackfillRunning = false;
		} catch { void 0; }
	}
}

export async function runSimilarityStartupMaintenance(plugin: EpochPlugin): Promise<void> {
	const runtime = plugin as unknown as SimilarityRuntime;
	try {
		if (runtime.__epochDidSimilarityStartupMaintenance === true) return;
	} catch { void 0; }

	try {
		if (!hasSimilarityAccess(plugin)) return;
	} catch {
		return;
	}

	try {
		runtime.__epochDidSimilarityStartupMaintenance = true;
	} catch { void 0; }

	// Give Obsidian time to settle; avoid doing vault-wide scans during startup.
	// In tests, do not delay.
	const isTestEnv = isVitestEnv();
	await sleep(isTestEnv ? 0 : Platform.isMobile ? 30000 : 15000);

	const vectorsEnabled = embeddingsSimilarityEnabled(plugin);
	const topicsEnabled = isTopicSimilarityEnabled(plugin);
	if (!vectorsEnabled && !topicsEnabled) return;

	const files = sortFilesNewestRecordFirst(
		plugin,
		plugin.app.vault
			.getFiles()
			.filter((f: unknown) => {
				try {
					if (!f) return false;
					if (!(f instanceof TFile)) return false;
					if (!plugin.shouldIndexFile(f)) return false;
					const ext = getLowerFileExtension(f);
					return isLikelyTextFileExtension(ext);
				} catch {
					return false;
				}
			})
	);

	// Huge vault behavior: enqueue ALL missing vector work immediately so the semantics
	// progress total reflects the whole eligible vault (enqueueing is cheap; processing
	// remains throttled in the vector queue).
	const isHuge = files.length > 5000;
	if (isHuge && vectorsEnabled) {
		try {
			let store: VectorStoreLike | null = null;
			try {
				store = await readStore(plugin);
			} catch {
				store = null;
			}

			for (let i = 0; i < files.length; i++) {
				const f = files[i];
				const p = String(f.path ?? "").trim();
				if (!p) continue;
				if (store?.files) {
					const existing = store.files[p];
					const hasHash = typeof existing?.h === "string" && existing.h.trim().length > 0;
					const hasVector = Array.isArray(existing?.v);
					if (hasHash && hasVector) continue;
				}
				runtime.queueVectorUpdate?.(p);
				if ((i + 1) % 100 === 0) {
					await sleep(0);
				}
			}
			try {
				runtime.__epochHugeVectorsQueuedAll = true;
			} catch {
				// ignore
			}
		} catch {
			// ignore
		}
	}
	try {
		if (Platform.isDesktop) {
			void runtime.ensureTermSimilarityStoreLoaded?.();
		}
	} catch { void 0; }
	try {
		runtime.__epochHugeSimilarityBackfillFiles = files;
		runtime.__epochHugeSimilarityBackfillIndex = 0;
	} catch { void 0; }
	if (isHuge && vectorsEnabled && !topicsEnabled) {
		try {
			runtime.__epochHugeSimilarityBackfillFiles = null;
			runtime.__epochHugeSimilarityBackfillIndex = 0;
		} catch { void 0; }
		return;
	}
	scheduleHugeVaultSimilarityBackfill(plugin, isTestEnv ? 0 : Platform.isMobile ? 2000 : 0);
}
