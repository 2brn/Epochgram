import type { EpochPlugin } from "../../main";
import type { SimilarityMethods } from "./api-types";
import { isSimilarityEnabled, isTopicSimilarityEnabled } from "./config";
import { now } from "./time";
import { getEmbeddingTermForPath, getTermVocabulary } from "./topic";
import { sortFilesNewestRecordFirst } from "./files";
import { scheduleProcessPendingTermSimilarityQueue, ensureTermStoreExistsSoon } from "./topic-queue";
import { readTermStore, writeTermStore } from "../similarity-term-store";
import { getSimilarityWorker } from "./worker-factory";
import { canonicalizeTopicTerm, parseTopicTerm } from "utils";
import { hasSimilarityAccess } from "../pro-feature-state";

export const methodsTopic: Pick<
	SimilarityMethods,
	| "scheduleMissingTopicClassificationSweep"
	| "queueTermSimilarityUpdate"
	| "removeTermSimilarity"
	| "renameTermSimilarity"
	| "ensureTermSimilarityStoreLoaded"
	| "reloadTermSimilaritiesFromDisk"
	| "renameTopicGroup"
> = {
	scheduleMissingTopicClassificationSweep(this: EpochPlugin, reason?: string): void {
		try {
			if (!hasSimilarityAccess(this)) return;
		} catch {
			// ignore
		}
		const anyPlugin: any = this as any;
		try {
			void reason;
			if (anyPlugin.__epochTopicClassificationSweepTimer != null) return;
			anyPlugin.__epochTopicClassificationSweepTimer = window.setTimeout(() => {
				anyPlugin.__epochTopicClassificationSweepTimer = null;
				void (async () => {
					try {
						if (!isTopicSimilarityEnabled(this)) {
							try {
								anyPlugin.termSimilarityPendingFiles = new Set<string>();
								anyPlugin.termSimilarityQueueTotal = 0;
								anyPlugin.termSimilarityQueueProcessed = 0;
							} catch {
								// ignore
							}
							return;
						}

						const vocab = getTermVocabulary(this);
						if (!vocab.terms || vocab.terms.length === 0) return;

						let store;
						try {
							store = await readTermStore(this);
						} catch {
							return;
						}

						try {
							anyPlugin.similarityRebuildStartedAt = now();
						} catch {
							// ignore
						}

						const all = this.app.vault.getMarkdownFiles();
						if (String(reason || "") === "startup" && all.length > 5000) {
							return;
						}
						const mdFiles = sortFilesNewestRecordFirst(this, all.filter((f) => this.shouldIndexFile(f)));
						let enq = 0;
						for (const f of mdFiles) {
							try {
								const explicit = getEmbeddingTermForPath(this, f.path);
								if (explicit) continue;
							} catch {
								// ignore
							}
							const rec: any = (store.files as any)?.[f.path];
							const termOk = typeof rec?.term === "string" && rec.term.trim().length > 0;
							const hashOk = typeof rec?.h === "string" && rec.h.trim().length > 0;
							const vocabOk = typeof rec?.vocabularySig === "string" && rec.vocabularySig === vocab.sig;
							if (termOk && hashOk && vocabOk) continue;
							try {
								const pending: Set<string> =
									anyPlugin.termSimilarityPendingFiles instanceof Set
										? anyPlugin.termSimilarityPendingFiles
										: (anyPlugin.termSimilarityPendingFiles = new Set<string>());
								if (!pending.has(f.path)) {
									(this as any).queueTermSimilarityUpdate?.(f.path);
									enq++;
								}
							} catch {
								// ignore
							}
							if (enq % 50 === 0) {
							await new Promise((r) => window.setTimeout(r, 0));
							}
						}
					} catch {
						// ignore
					}
				})().catch(() => {
					// swallow
				});
			}, 250);
		} catch {
			// ignore
		}
	},

	queueTermSimilarityUpdate(this: EpochPlugin, filePath: string): void {
		if (!hasSimilarityAccess(this)) return;
		if (!isSimilarityEnabled(this)) return;
		if (!isTopicSimilarityEnabled(this)) return;
		const w = getSimilarityWorker(this);
		if (!w) return;
		const p = String(filePath || "");
		if (!p) return;
		if (p.startsWith("epoch://")) return;
		if (!/\.md$/i.test(p)) return;
		const anyPlugin: any = this as any;
		const pending: Set<string> =
			anyPlugin.termSimilarityPendingFiles instanceof Set
				? anyPlugin.termSimilarityPendingFiles
				: (anyPlugin.termSimilarityPendingFiles = new Set<string>());
		if (pending.has(p)) return;
		pending.add(p);
		ensureTermStoreExistsSoon(this);
		scheduleProcessPendingTermSimilarityQueue(this, 50);
	},

	async removeTermSimilarity(this: EpochPlugin, filePath: string): Promise<void> {
		const store = await readTermStore(this);
		if (store.files[filePath]) {
			delete store.files[filePath];
			await writeTermStore(this, store);
		}
	},

	async renameTermSimilarity(this: EpochPlugin, oldPath: string, newPath: string): Promise<void> {
		const store = await readTermStore(this);
		const existing = store.files[oldPath];
		if (!existing) return;
		delete store.files[oldPath];
		store.files[newPath] = existing;
		await writeTermStore(this, store);
	},

	async ensureTermSimilarityStoreLoaded(this: EpochPlugin): Promise<void> {
		try {
			await readTermStore(this);
		} catch {
			// ignore
		}
	},

	async reloadTermSimilaritiesFromDisk(this: EpochPlugin): Promise<void> {
		try {
			const anyPlugin: any = this as any;
			anyPlugin.termSimilarityLoaded = false;
			anyPlugin.termSimilarityIndex = null;
			try {
				await (this as any).updateTermSimilarityFileStat?.();
			} catch {
				// ignore
			}
			try {
				(this as any).scheduleInheritedMarkRecompute?.("term-sim-sync");
			} catch {
				// ignore
			}
			this.refreshEpochViews();
		} catch {
			// ignore
		}
	},

	async renameTopicGroup(this: EpochPlugin, oldTopic: string, newTopic: string): Promise<void> {
		const oldTerm = canonicalizeTopicTerm(String(oldTopic || "").trim());
		const nextTerm = canonicalizeTopicTerm(String(newTopic || "").trim());
		if (!oldTerm) return;
		const oldParsed = parseTopicTerm(oldTerm);
		const includeClassifiedPaths = oldParsed.kind === "auto";
		try {
			if (!this.hasProAccess?.()) return;
		} catch {
			// ignore
		}

		const anyPlugin: any = this as any;
		try {
			await readTermStore(this);
		} catch {
			// ignore
		}
		const store = await readTermStore(this);

		const classifiedPaths = new Set<string>();
		const explicitPaths = new Set<string>();
		if (includeClassifiedPaths) {
			try {
				for (const [p, rec] of Object.entries(store.files ?? {})) {
					if (!p || typeof p !== "string") continue;
					const t0 = typeof (rec as any)?.term === "string" ? String((rec as any).term).trim() : "";
					const t = canonicalizeTopicTerm(t0);
					if (t && t === oldTerm) classifiedPaths.add(p);
				}
			} catch {
				// ignore
			}
		}
		try {
			const idxAny: any = this.indexer as any;
			const indexed: unknown = idxAny.getIndexedPaths();
			const paths: string[] = Array.isArray(indexed) ? indexed : [];
			for (const p of paths) {
				if (!p || typeof p !== "string") continue;
				if (p.startsWith("epoch://")) continue;
				const t0 =
					String(idxAny.getFileEmbeddingTerm(p) || "").trim();
				const t = canonicalizeTopicTerm(t0);
				if (t && t === oldTerm) explicitPaths.add(p);
			}
		} catch {
			// ignore
		}

		const groupPaths = new Set<string>([...classifiedPaths, ...explicitPaths]);
		if (groupPaths.size === 0) return;

		try {
			const idxAny: any = this.indexer as any;
			for (const p of explicitPaths) {
				try {
					idxAny.setFileEmbeddingTerm(p, nextTerm);
				} catch {
					// ignore
				}
			}
		} catch {
			// ignore
		}

		if (includeClassifiedPaths) {
			try {
				for (const [p, rec] of Object.entries(store.files ?? {})) {
					if (!p || !rec) continue;
					const t0 = typeof (rec as any)?.term === "string" ? String((rec as any).term).trim() : "";
					const t = canonicalizeTopicTerm(t0);
					if (!t || t !== oldTerm) continue;
					if (!nextTerm) {
						delete (store.files as any)[p];
						continue;
					}
					(rec as any).term = nextTerm;
					(rec as any).updatedAt = now();
				}
			} catch {
				// ignore
			}
		}

		await writeTermStore(this, store);

		try {
			for (const p of groupPaths) {
				try {
					(this as any).queueVectorUpdate?.(p);
				} catch {
					// ignore
				}
				try {
					(this as any).queueTermSimilarityUpdate?.(p);
				} catch {
					// ignore
				}
			}
		} catch {
			// ignore
		}

		try {
			await (this as any).persistIndex?.({ skipEnsure: true });
		} catch {
			// ignore
		}

		try {
			(this as any)?.scheduleMissingTopicClassificationSweep?.("topic-rename");
		} catch {
			// ignore
		}
		try {
			anyPlugin.termSimilarityStoreRev =
				(typeof anyPlugin.termSimilarityStoreRev === "number" ? anyPlugin.termSimilarityStoreRev : 0) + 1;
		} catch {
			// ignore
		}

		// Topic group changes affect inherited mark propagation.
		try {
			(this as any).scheduleInheritedMarkRecompute?.(nextTerm ? "topic-rename" : "topic-remove");
		} catch {
			// ignore
		}
		this.refreshEpochViews();
	}
};
