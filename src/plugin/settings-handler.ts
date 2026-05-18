import type { EpochSettings } from "../settings";
import type { EpochPlugin } from "../main";
import { Notice } from "obsidian";
import { updateAggregatedEntriesInternal } from "../indexer/update-aggregated-entries";
import { sortIndex } from "../indexer/indexer-utils";
import { writeTermStore } from "./similarity-term-store";
import { DEFAULT_SIMILARITY_MODEL, DEFAULT_ZERO_SHOT_MODEL, NO_SIMILARITY_MODEL } from "./similarity/config";
import { loadEmbeddingsModelViaWorker } from "./similarity/worker-embed";
import { loadZeroShotModelViaWorkerWithId } from "./similarity/worker-zeroshot";
import { isGenerateEpochsEffective } from "./pro-feature-state";

export interface SettingsHandlerMethods {
	onSettingsChanged(key: keyof EpochSettings): Promise<void>;
}

export const settingsHandlerMethods: SettingsHandlerMethods = {
	async onSettingsChanged(this: EpochPlugin, key: keyof EpochSettings): Promise<void> {
		await this.saveSettings();

			const sanitizeNoticeMessage = (value: string): string => {
				const raw = String(value ?? "").replace(/\r/g, "").trim();
				if (!raw) return "";
				const lines = raw.split("\n");
				const kept: string[] = [];
				for (const line of lines) {
					const t = String(line ?? "").trim();
					if (!t) continue;
					if (/^at\s+/.test(t)) break;
					if (t.includes("blob:app://")) break;
					kept.push(t);
					if (kept.length >= 3) break;
				}
				let out = kept.length ? kept.join(" ") : raw.split("\n")[0].trim();
				out = out.replace(/\s+/g, " ").trim();
				const MAX = 280;
				if (out.length > MAX) out = `${out.slice(0, MAX - 1).trimEnd()}…`;
				return out;
			};

		const shouldAttemptModelLoad = (modelId: string, kind: "semantics" | "topics"): boolean => {
			const id = String(modelId || "").trim();
			if (!id) return false;
			return true;
		};

		const rememberModelLoadFailure = (modelId: string, kind: "semantics" | "topics"): void => {
			const id = String(modelId || "").trim();
			if (!id) return;
			try {
				const anyPlugin: any = this as any;
				if (!anyPlugin.__epochModelLoadFailed) anyPlugin.__epochModelLoadFailed = new Set<string>();
				const s: Set<string> = anyPlugin.__epochModelLoadFailed;
				s.add(`${kind}:${id}`);
			} catch {
				// ignore
			}
		};

		const showModelLoadNoticeOnce = (modelId: string, kind: "semantics" | "topics", message: string): void => {
				const msg = sanitizeNoticeMessage(String(message || "").trim());
			if (!msg) return;
			try {
				const anyPlugin: any = this as any;
				const k = `${kind}:${String(modelId || "").trim()}`;
				const lastKey = String(anyPlugin.__epochModelLoadNoticeKey ?? "");
				const lastAt = Number(anyPlugin.__epochModelLoadNoticeAt ?? 0);
				const within = lastAt > 0 && (Date.now() - lastAt) < 8000;
				if (within && lastKey === k) return;
				anyPlugin.__epochModelLoadNoticeKey = k;
				anyPlugin.__epochModelLoadNoticeAt = Date.now();
			} catch {
				// ignore
			}
			try {
				new Notice(msg, 6000);
			} catch {
				// ignore
			}
		};

		const showModelReadyNoticeOnce = (modelId: string, kind: "semantics" | "topics"): void => {
			const id = String(modelId || "").trim();
			if (!id) return;
			try {
				const anyPlugin: any = this as any;
				if (!anyPlugin.__epochModelLoadReadyShown) anyPlugin.__epochModelLoadReadyShown = new Set<string>();
				const s: Set<string> = anyPlugin.__epochModelLoadReadyShown;
				const k = `${kind}:${id}`;
				if (s.has(k)) return;
				s.add(k);
			} catch {
				// ignore
			}
			const label = kind === "topics" ? "Topics model ready" : "Semantics model ready";
			try {
				new Notice(`${label}: ${id}`, 4500);
			} catch {
				// ignore
			}
		};

		const refreshSettingsUi = (): void => {
			try {
				const anyPlugin: any = this as any;
				anyPlugin.__epochSettingTab?.display?.();
			} catch {
				// ignore
			}
		};

		if (key === "similarityEmbeddingModelId") {
			this.refreshEpochViews();
			void (async () => {
				const raw = (this.settings as any)?.similarityEmbeddingModelId;
				if (raw !== NO_SIMILARITY_MODEL) {
					const override = typeof raw === "string" ? raw.trim() : "";
					const modelId = override || DEFAULT_SIMILARITY_MODEL;
					if (shouldAttemptModelLoad(modelId, "semantics")) {
						const ok = await loadEmbeddingsModelViaWorker(this, modelId);
						if (ok) {
							showModelReadyNoticeOnce(modelId, "semantics");
						} else {
							const lastErr = String((this as any)?.similarityWorkerLastLoadError ?? "").trim();
							const reason = lastErr ? ` ${lastErr}` : "";
							showModelLoadNoticeOnce(
								modelId,
								"semantics",
								`Semantics model failed to load: ${modelId}.${reason}`
							);
							rememberModelLoadFailure(modelId, "semantics");
							try {
								(this.settings as any).similarityEmbeddingModelId = NO_SIMILARITY_MODEL;
								await this.saveSettings();
								refreshSettingsUi();
							} catch {
								// ignore
							}
						}
					}
				}
				try {
					const anyPlugin: any = this as any;
					anyPlugin.similarityVectorsLoaded = false;
					anyPlugin.similarityIndex = null;
					// Force the "vectors enabled" sweep to run again for the new model.
					anyPlugin.similarityLastVectorsEnabled = false;
				} catch {
					// ignore
				}
				try {
					await (this as any).reloadVectorsFromDisk?.();
				} catch {
					// ignore
				}
				try {
					await (this as any).onSimilaritySettingsChanged?.("similarityThreshold");
				} catch {
					// ignore
				}
				try {
					await (this as any).recomputeInheritedMarksNow?.(key);
				} catch {
					// ignore
				}
				this.refreshEpochViews();
			})();
			return;
		}

		if (key === "similarityZeroShotModelId") {
			this.refreshEpochViews();
			void (async () => {
				const raw = (this.settings as any)?.similarityZeroShotModelId;
				if (raw !== NO_SIMILARITY_MODEL) {
					const override = typeof raw === "string" ? raw.trim() : "";
					const modelId = override || DEFAULT_ZERO_SHOT_MODEL;
					if (shouldAttemptModelLoad(modelId, "topics")) {
						const ok = await loadZeroShotModelViaWorkerWithId(this, modelId);
						if (ok) {
							showModelReadyNoticeOnce(modelId, "topics");
						} else {
							showModelLoadNoticeOnce(
								modelId,
								"topics",
								`Topics model failed to load: ${modelId}.`
							);
							rememberModelLoadFailure(modelId, "topics");
							try {
								(this.settings as any).similarityZeroShotModelId = NO_SIMILARITY_MODEL;
								await this.saveSettings();
								refreshSettingsUi();
							} catch {
								// ignore
							}
						}
					}
				}
				try {
					const anyPlugin: any = this as any;
					anyPlugin.termSimilarityLoaded = false;
					anyPlugin.termSimilarityIndex = null;
					anyPlugin.termSimilarityPendingFiles = new Set<string>();
					anyPlugin.termSimilarityQueueTotal = 0;
					anyPlugin.termSimilarityQueueProcessed = 0;
				} catch {
					// ignore
				}
				// Clear existing topic classifications so the new model can repopulate them.
				try {
					await writeTermStore(this, { model: "zeroshot", files: {} } as any);
				} catch {
					// ignore
				}
				try {
					await (this as any).reloadTermSimilaritiesFromDisk?.();
				} catch {
					// ignore
				}
				try {
					(this as any).scheduleMissingTopicClassificationSweep?.("similarityZeroShotModelId");
				} catch {
					// ignore
				}
				try {
					await (this as any).recomputeInheritedMarksNow?.(key);
				} catch {
					// ignore
				}
				this.refreshEpochViews();
			})();
			return;
		}

		if (key === "similarityThreshold") {
			// Threshold affects "related" highlights; refresh immediately and again after
			// any async similarity + mark recompute completes.
			this.refreshEpochViews();
			void (async () => {
				try {
					await (this as any).onSimilaritySettingsChanged?.(key);
				} catch {
					// ignore
				}
				try {
					await (this as any).recomputeInheritedMarksNow?.(key);
				} catch {
					// ignore
				}
				this.refreshEpochViews();
			})();
		}

		if (key === "similarityZeroShotMinScore") {
			// Topic threshold affects topic-based semantic related searches and highlights.
			this.refreshEpochViews();
			void (async () => {
				try {
					await (this as any).onSimilaritySettingsChanged?.(key);
				} catch {
					// ignore
				}
				try {
					await (this as any).recomputeInheritedMarksNow?.(key);
				} catch {
					// ignore
				}
				this.refreshEpochViews();
			})();
		}

		if (
			key === "similarityUseLinks" ||
			key === "similarityUseTags" ||
			key === "similarityTitleJwThreshold"
		) {
			this.refreshEpochViews();
			void (async () => {
				try {
					await (this as any).recomputeInheritedMarksNow?.(key);
				} catch {
					// ignore
				}
				this.refreshEpochViews();
			})();
		}

		if (key === "generateEpochs") {
			if (!isGenerateEpochsEffective(this)) {
				if ((this.viewPreferences as any).showEpochsView) {
					(this.viewPreferences as any).showEpochsView = false;
				}
				// Note: disabling epochs should not delete already-generated epoch summaries.
				// This avoids re-queuing large "missing" batches when the user re-enables the setting.
				this.refreshEpochViews();
				return;
			}
			// Enabled: do not auto-generate. The settings UI may optionally prompt the user
			// to queue missing epochs.
			this.refreshEpochViews();
			return;
		}

		if (key === "summarizeAI") {
			await this.ensureIndexLoaded();
			const paths = this.indexer.getIndexedPaths();
			for (const p of paths) {
				try {
					updateAggregatedEntriesInternal(this.indexer as any, p, { skipSort: true });
				} catch {
					// ignore per-file failures
				}
			}
			this.indexer.index = sortIndex(this.indexer.index);
			this.refreshEpochViews();
			return;
		}

		if (key === "openAiBridgeOnStartup") {
			try {
				void (this as any).refreshAiBridgeStatusBar?.();
			} catch {
				// ignore
			}
			return;
		}


		if (
			key === "filenameWordsCount" ||
			key === "summaryWordsCount" ||
			key === "trackChanges" ||
			key === "anchorMdate" ||
			key === "parseDatesInFrontmatter" ||
			key === "yamlDateProperty" ||
			key === "yamlDescriptionProperty"
		) {
			await this.refreshIndexSmartWithProgress();
			if (key === "parseDatesInFrontmatter") {
				try {
					const showParsed = this.viewPreferences?.showParsed !== false;
					this.viewPreferences.showParsed = showParsed;
				} catch {
					// ignore
				}
				this.refreshEpochViews();
			}
		}

		if (key === "enableAnimation") {
			this.refreshEpochViews();
			return;
		}

		if (key === "compactModeMinWidthPercent") {
			this.refreshEpochViews();
			return;
		}

		if (key === "trackChanges") {
			this.registerFileEvents();
		}
	}
};
