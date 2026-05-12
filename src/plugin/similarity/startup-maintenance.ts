import { Platform } from "obsidian";
import type { EpochPlugin } from "../../main";
import { embeddingsSimilarityEnabled, isTopicSimilarityEnabled } from "./config";
import { readStore } from "./store";
import { readTermStore } from "../similarity-term-store";
import { getEmbeddingTermForPath, getTermVocabulary } from "./topic";
import { isLikelyTextFileExtension } from "../../utils";
import { sleep } from "./time";
import { sortFilesNewestRecordFirst } from "./files";
import { hasSimilarityAccess } from "../pro-feature-state";

function getLowerFileExtension(file: any): string {
	const ext = String(file?.extension ?? "").trim();
	if (ext) return ext.toLowerCase();
	const p = String(file?.path ?? "");
	const lastDot = p.lastIndexOf(".");
	if (lastDot <= -1) return "";
	return p.slice(lastDot + 1).toLowerCase();
}

function scheduleHugeVaultSimilarityBackfill(plugin: EpochPlugin, delayMs: number): void {
	const anyPlugin: any = plugin as any;
	try {
		if (anyPlugin.__epochHugeSimilarityBackfillTimer != null) return;
	} catch {}
	try {
		anyPlugin.__epochHugeSimilarityBackfillTimer = setTimeout(() => {
			try {
				anyPlugin.__epochHugeSimilarityBackfillTimer = null;
			} catch {}
			void runHugeVaultSimilarityBackfillTick(plugin);
		}, Math.max(0, Math.floor(delayMs)));
	} catch {}
}

async function runHugeVaultSimilarityBackfillTick(plugin: EpochPlugin): Promise<void> {
	const anyPlugin: any = plugin as any;
	try {
		if (anyPlugin.__epochHugeSimilarityBackfillRunning) return;
		anyPlugin.__epochHugeSimilarityBackfillRunning = true;
	} catch {}
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
				return anyPlugin.__epochHugeVectorsQueuedAll === true;
			} catch {
				return false;
			}
		})();

		const files: any[] = Array.isArray(anyPlugin.__epochHugeSimilarityBackfillFiles)
			? (anyPlugin.__epochHugeSimilarityBackfillFiles as any[])
			: (anyPlugin.__epochHugeSimilarityBackfillFiles = sortFilesNewestRecordFirst(
				plugin,
				plugin.app.vault
					.getFiles()
					.filter((f) => {
						try {
							if (!f) return false;
							if (!plugin.shouldIndexFile(f as any)) return false;
							const ext = getLowerFileExtension(f);
							return isLikelyTextFileExtension(ext);
						} catch {
							return false;
						}
					})
			));
		if (!Array.isArray(files) || files.length === 0) return;

		const nextIndexRaw = Number(anyPlugin.__epochHugeSimilarityBackfillIndex ?? 0);
		let nextIndex = Number.isFinite(nextIndexRaw) ? Math.max(0, Math.floor(nextIndexRaw)) : 0;
		if (nextIndex >= files.length) {
			anyPlugin.__epochHugeSimilarityBackfillFiles = null;
			anyPlugin.__epochHugeSimilarityBackfillIndex = 0;
			return;
		}

		const topicPending = (() => {
			try {
				return anyPlugin.termSimilarityPendingFiles instanceof Set ? anyPlugin.termSimilarityPendingFiles.size : 0;
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

		let store: any = null;
		let termStore: any = null;
		let vocab: { terms: string[]; sig: string } | null = null;
		let enqTopics = 0;

		let scanned = 0;
		for (; nextIndex < files.length && scanned < SCAN_PER_TICK; nextIndex++) {
			scanned++;
			const f: any = files[nextIndex];
			const p = String(f?.path ?? "").trim();
			if (!p) continue;
			const ext = getLowerFileExtension(f);
			try {
				if (!plugin.shouldIndexFile(f)) continue;
			} catch {}
			try {
				if (!isLikelyTextFileExtension(ext)) continue;
			} catch {}

			if (!vectorsQueuedAll && vectorsEnabled) {
				try {
					if (!store) store = await readStore(plugin);
					const existing: any = (store.files as any)?.[p];
					const hasHash = typeof existing?.h === "string" && existing.h.trim().length > 0;
					const hasVector = Array.isArray(existing?.v);
					if (!(hasHash && hasVector)) {
						(plugin as any).queueVectorUpdate?.(p);
					}
				} catch {}
			}

			if (topicsEnabled && enqTopics < MAX_ENQUEUE_TOPICS_PER_TICK && ext === "md") {
				try {
					const explicit = String(getEmbeddingTermForPath(plugin, p) || "").trim();
					if (explicit) continue;
				} catch {}
				try {
					if (!vocab) vocab = getTermVocabulary(plugin);
					if (!vocab.terms || vocab.terms.length === 0) {
						continue;
					}
					if (!termStore) termStore = await readTermStore(plugin);
					const rec: any = (termStore.files as any)?.[p];
					const termOk = typeof rec?.term === "string" && rec.term.trim().length > 0;
					const hashOk = typeof rec?.h === "string" && rec.h.trim().length > 0;
					const vocabOk = typeof rec?.vocabularySig === "string" && rec.vocabularySig === vocab.sig;
					if (!(termOk && hashOk && vocabOk)) {
						(plugin as any).queueTermSimilarityUpdate?.(p);
						enqTopics++;
					}
				} catch {}
			}

			if ((nextIndex + 1) % 50 === 0) {
				await sleep(0);
			}

			if (enqTopics >= MAX_ENQUEUE_TOPICS_PER_TICK) {
				nextIndex++;
				break;
			}
		}

		anyPlugin.__epochHugeSimilarityBackfillIndex = nextIndex;
		if (nextIndex >= files.length) {
			anyPlugin.__epochHugeSimilarityBackfillFiles = null;
			anyPlugin.__epochHugeSimilarityBackfillIndex = 0;
			return;
		}

		const isTestEnv = (() => {
			try {
				return typeof process !== "undefined" && !!(process as any)?.env?.VITEST;
			} catch {
				return false;
			}
		})();
		scheduleHugeVaultSimilarityBackfill(plugin, isTestEnv ? 0 : Platform.isMobileApp ? 2000 : 250);
	} finally {
		try {
			anyPlugin.__epochHugeSimilarityBackfillRunning = false;
		} catch {}
	}
}

export async function runSimilarityStartupMaintenance(plugin: EpochPlugin): Promise<void> {
	const anyPlugin: any = plugin as any;
	try {
		if (anyPlugin.__epochDidSimilarityStartupMaintenance === true) return;
	} catch {}

	try {
		if (!hasSimilarityAccess(plugin)) return;
	} catch {
		return;
	}

	try {
		anyPlugin.__epochDidSimilarityStartupMaintenance = true;
	} catch {}

	// Give Obsidian time to settle; avoid doing vault-wide scans during startup.
	// In tests, do not delay.
	const isTestEnv = (() => {
		try {
			return typeof process !== "undefined" && !!(process as any)?.env?.VITEST;
		} catch {
			return false;
		}
	})();
	await sleep(isTestEnv ? 0 : Platform.isMobileApp ? 30000 : 15000);

	const vectorsEnabled = embeddingsSimilarityEnabled(plugin);
	const topicsEnabled = isTopicSimilarityEnabled(plugin);
	if (!vectorsEnabled && !topicsEnabled) return;

	const files = sortFilesNewestRecordFirst(
		plugin,
		plugin.app.vault
			.getFiles()
			.filter((f: any) => {
				try {
					if (!f) return false;
					if (!plugin.shouldIndexFile(f as any)) return false;
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
			let store: any = null;
			try {
				store = await readStore(plugin);
			} catch {
				store = null;
			}

			for (let i = 0; i < files.length; i++) {
				const f: any = files[i];
				const p = String(f?.path ?? "").trim();
				if (!p) continue;
				if (store && store.files) {
					const existing: any = (store.files as any)?.[p];
					const hasHash = typeof existing?.h === "string" && existing.h.trim().length > 0;
					const hasVector = Array.isArray(existing?.v);
					if (hasHash && hasVector) continue;
				}
				(plugin as any).queueVectorUpdate?.(p);
				if ((i + 1) % 100 === 0) {
					await sleep(0);
				}
			}
			try {
				(anyPlugin as any).__epochHugeVectorsQueuedAll = true;
			} catch {
				// ignore
			}
		} catch {
			// ignore
		}
	}
	try {
		if (Platform.isDesktopApp) {
			(plugin as any).ensureTermSimilarityStoreLoaded?.();
		}
	} catch {}
	try {
		const anyPlugin2: any = plugin as any;
		anyPlugin2.__epochHugeSimilarityBackfillFiles = files;
		anyPlugin2.__epochHugeSimilarityBackfillIndex = 0;
	} catch {}
	if (isHuge && vectorsEnabled && !topicsEnabled) {
		try {
			const anyPlugin2: any = plugin as any;
			anyPlugin2.__epochHugeSimilarityBackfillFiles = null;
			anyPlugin2.__epochHugeSimilarityBackfillIndex = 0;
		} catch {}
		return;
	}
	scheduleHugeVaultSimilarityBackfill(plugin, isTestEnv ? 0 : Platform.isMobileApp ? 2000 : 0);
}
