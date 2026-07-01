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

type TermStoreRecord = {
	term?: string;
	score: number;
	h?: string;
	vocabularySig?: string;
	updatedAt?: number;
};

type TermStoreLike = { files: Record<string, TermStoreRecord> };

type TopicMethodsRuntime = {
	__epochTopicClassificationSweepTimer?: number | null;
	termSimilarityPendingFiles?: Set<string>;
	termSimilarityQueueTotal?: number;
	termSimilarityQueueProcessed?: number;
	similarityRebuildStartedAt?: number;
	termSimilarityLoaded?: boolean;
	termSimilarityIndex?: unknown;
	updateTermSimilarityFileStat?: () => Promise<void>;
	scheduleInheritedMarkRecompute?: (reason?: string) => void;
	queueTermSimilarityUpdate?: (path: string) => void;
	queueVectorUpdate?: (path: string) => void;
	persistIndex?: (options?: { skipEnsure?: boolean }) => Promise<void>;
	scheduleMissingTopicClassificationSweep?: (reason?: string) => void;
	termSimilarityStoreRev?: number;
};

type TopicIndexerLike = {
	getIndexedPaths: () => string[];
	getFileEmbeddingTerm: (path: string) => string;
	setFileEmbeddingTerm: (path: string, term: string) => void;
};

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
		try {
			void reason;
			const runtime = this as unknown as TopicMethodsRuntime;
			if (runtime.__epochTopicClassificationSweepTimer != null) return;
			runtime.__epochTopicClassificationSweepTimer = window.setTimeout(() => {
				runtime.__epochTopicClassificationSweepTimer = null;
				void (async () => {
					try {
						if (!isTopicSimilarityEnabled(this)) {
							try {
								runtime.termSimilarityPendingFiles = new Set<string>();
								runtime.termSimilarityQueueTotal = 0;
								runtime.termSimilarityQueueProcessed = 0;
							} catch {
								// ignore
							}
							return;
						}

						const vocab = getTermVocabulary(this);
						if (!vocab.terms || vocab.terms.length === 0) return;

						let store: TermStoreLike;
						try {
							store = await readTermStore(this);
						} catch {
							return;
						}

						try {
							runtime.similarityRebuildStartedAt = now();
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
							const rec = store.files[f.path];
							const termOk = typeof rec?.term === "string" && rec.term.trim().length > 0;
							const hashOk = typeof rec?.h === "string" && rec.h.trim().length > 0;
							const vocabOk = typeof rec?.vocabularySig === "string" && rec.vocabularySig === vocab.sig;
							if (termOk && hashOk && vocabOk) continue;
							try {
								const pending: Set<string> =
									runtime.termSimilarityPendingFiles instanceof Set
										? runtime.termSimilarityPendingFiles
										: (runtime.termSimilarityPendingFiles = new Set<string>());
								if (!pending.has(f.path)) {
									runtime.queueTermSimilarityUpdate?.(f.path);
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
		const runtime = this as unknown as TopicMethodsRuntime;
		const pending: Set<string> =
			runtime.termSimilarityPendingFiles instanceof Set
				? runtime.termSimilarityPendingFiles
				: (runtime.termSimilarityPendingFiles = new Set<string>());
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
			const runtime = this as unknown as TopicMethodsRuntime;
			runtime.termSimilarityLoaded = false;
			runtime.termSimilarityIndex = null;
			try {
				await runtime.updateTermSimilarityFileStat?.();
			} catch {
				// ignore
			}
			try {
				runtime.scheduleInheritedMarkRecompute?.("term-sim-sync");
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

		const runtime = this as unknown as TopicMethodsRuntime;
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
				for (const [p, rec] of Object.entries<TermStoreRecord>(store.files ?? {})) {
					if (!p || typeof p !== "string") continue;
					const t0 = typeof rec?.term === "string" ? String(rec.term).trim() : "";
					const t = canonicalizeTopicTerm(t0);
					if (t && t === oldTerm) classifiedPaths.add(p);
				}
			} catch {
				// ignore
			}
		}
		try {
			const idxAny = this.indexer as unknown as TopicIndexerLike;
			const paths: string[] = idxAny.getIndexedPaths();
			for (const p of paths) {
				if (!p || typeof p !== "string") continue;
				if (p.startsWith("epoch://")) continue;
				const t0 = String(idxAny.getFileEmbeddingTerm(p) || "").trim();
				const t = canonicalizeTopicTerm(t0);
				if (t && t === oldTerm) explicitPaths.add(p);
			}
		} catch {
			// ignore
		}

		const groupPaths = new Set<string>([...classifiedPaths, ...explicitPaths]);
		if (groupPaths.size === 0) return;

		try {
			const idxAny = this.indexer as unknown as TopicIndexerLike;
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
				for (const [p, rec] of Object.entries<TermStoreRecord>(store.files ?? {})) {
					if (!p || !rec) continue;
					const t0 = typeof rec?.term === "string" ? String(rec.term).trim() : "";
					const t = canonicalizeTopicTerm(t0);
					if (!t || t !== oldTerm) continue;
					if (!nextTerm) {
						delete store.files[p];
						continue;
					}
					rec.term = nextTerm;
					rec.updatedAt = now();
				}
			} catch {
				// ignore
			}
		}

		await writeTermStore(this, store);

		try {
			for (const p of groupPaths) {
				try {
					runtime.queueVectorUpdate?.(p);
				} catch {
					// ignore
				}
				try {
					runtime.queueTermSimilarityUpdate?.(p);
				} catch {
					// ignore
				}
			}
		} catch {
			// ignore
		}

		try {
			await runtime.persistIndex?.({ skipEnsure: true });
		} catch {
			// ignore
		}

		try {
			runtime.scheduleMissingTopicClassificationSweep?.("topic-rename");
		} catch {
			// ignore
		}
		try {
			runtime.termSimilarityStoreRev =
				(typeof runtime.termSimilarityStoreRev === "number" ? runtime.termSimilarityStoreRev : 0) + 1;
		} catch {
			// ignore
		}

		// Topic group changes affect inherited mark propagation.
		try {
			runtime.scheduleInheritedMarkRecompute?.(nextTerm ? "topic-rename" : "topic-remove");
		} catch {
			// ignore
		}
		this.refreshEpochViews();
	}
};
