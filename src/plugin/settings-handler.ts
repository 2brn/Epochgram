import type { EpochSettings } from "../settings";
import type { EpochPlugin } from "../main";
import { Notice } from "obsidian";
import { updateAggregatedEntriesInternal } from "../indexer/update-aggregated-entries";
import type { IndexerPipeline } from "../indexer/pipeline";
import { sortIndex } from "../indexer/indexer-utils";
import { writeTermStore } from "./similarity-term-store";
import { DEFAULT_SIMILARITY_MODEL, DEFAULT_ZERO_SHOT_MODEL, NO_SIMILARITY_MODEL } from "./similarity/config";
import { loadEmbeddingsModelViaWorker } from "./similarity/worker-embed";
import { loadZeroShotModelViaWorkerWithId } from "./similarity/worker-zeroshot";
import { isGenerateEpochsEffective } from "./pro-feature-state";

export interface SettingsHandlerMethods {
	onSettingsChanged(key: keyof EpochSettings): Promise<void>;
}

type SettingsHandlerRuntime = {
	__epochModelLoadFailed?: Set<string>;
	__epochModelLoadNoticeKey?: string;
	__epochModelLoadNoticeAt?: number;
	__epochModelLoadReadyShown?: Set<string>;
	__epochSettingTab?: { display?: () => void };
	similarityWorkerLastLoadError?: string;
	similarityVectorsLoaded?: boolean;
	similarityIndex?: unknown;
	similarityLastVectorsEnabled?: boolean;
	reloadVectorsFromDisk?: () => Promise<void>;
	onSimilaritySettingsChanged?: (key: keyof EpochSettings) => Promise<void>;
	recomputeInheritedMarksNow?: (reason?: string) => Promise<void>;
	termSimilarityLoaded?: boolean;
	termSimilarityIndex?: unknown;
	termSimilarityPendingFiles?: Set<string>;
	termSimilarityQueueTotal?: number;
	termSimilarityQueueProcessed?: number;
	reloadTermSimilaritiesFromDisk?: () => Promise<void>;
	scheduleMissingTopicClassificationSweep?: (reason?: string) => void;
	refreshAiBridgeStatusBar?: () => void;
	refreshCalendarSyncSchedule?: () => void;
};

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
				const runtime = this as unknown as SettingsHandlerRuntime;
				if (!runtime.__epochModelLoadFailed) runtime.__epochModelLoadFailed = new Set<string>();
				const s: Set<string> = runtime.__epochModelLoadFailed;
				s.add(`${kind}:${id}`);
			} catch {
				// ignore
			}
		};

		const showModelLoadNoticeOnce = (modelId: string, kind: "semantics" | "topics", message: string): void => {
				const msg = sanitizeNoticeMessage(String(message || "").trim());
			if (!msg) return;
			try {
				const runtime = this as unknown as SettingsHandlerRuntime;
				const k = `${kind}:${String(modelId || "").trim()}`;
				const lastKey = String(runtime.__epochModelLoadNoticeKey ?? "");
				const lastAt = Number(runtime.__epochModelLoadNoticeAt ?? 0);
				const within = lastAt > 0 && (Date.now() - lastAt) < 8000;
				if (within && lastKey === k) return;
				runtime.__epochModelLoadNoticeKey = k;
				runtime.__epochModelLoadNoticeAt = Date.now();
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
				const runtime = this as unknown as SettingsHandlerRuntime;
				if (!runtime.__epochModelLoadReadyShown) runtime.__epochModelLoadReadyShown = new Set<string>();
				const s: Set<string> = runtime.__epochModelLoadReadyShown;
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
				(this as unknown as SettingsHandlerRuntime).__epochSettingTab?.display?.();
			} catch {
				// ignore
			}
		};

		if (key === "similarityEmbeddingModelId") {
			this.refreshEpochViews();
			void (async () => {
				const raw = this.settings.similarityEmbeddingModelId;
				if (raw !== NO_SIMILARITY_MODEL) {
					const override = typeof raw === "string" ? raw.trim() : "";
					const modelId = override || DEFAULT_SIMILARITY_MODEL;
					if (shouldAttemptModelLoad(modelId, "semantics")) {
						const ok = await loadEmbeddingsModelViaWorker(this, modelId);
						if (ok) {
							showModelReadyNoticeOnce(modelId, "semantics");
						} else {
							const lastErr = String((this as unknown as SettingsHandlerRuntime).similarityWorkerLastLoadError ?? "").trim();
							const reason = lastErr ? ` ${lastErr}` : "";
							showModelLoadNoticeOnce(
								modelId,
								"semantics",
								`Semantics model failed to load: ${modelId}.${reason}`
							);
							rememberModelLoadFailure(modelId, "semantics");
							try {
								this.settings.similarityEmbeddingModelId = NO_SIMILARITY_MODEL;
								await this.saveSettings();
								refreshSettingsUi();
							} catch {
								// ignore
							}
						}
					}
				}
				try {
					(this as unknown as SettingsHandlerRuntime).similarityVectorsLoaded = false;
					(this as unknown as SettingsHandlerRuntime).similarityIndex = null;
					// Force the "vectors enabled" sweep to run again for the new model.
					(this as unknown as SettingsHandlerRuntime).similarityLastVectorsEnabled = false;
				} catch {
					// ignore
				}
				try {
					await (this as unknown as SettingsHandlerRuntime).reloadVectorsFromDisk?.();
				} catch {
					// ignore
				}
				try {
					await (this as unknown as SettingsHandlerRuntime).onSimilaritySettingsChanged?.("similarityThreshold");
				} catch {
					// ignore
				}
				try {
					await (this as unknown as SettingsHandlerRuntime).recomputeInheritedMarksNow?.(key);
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
				const raw = this.settings.similarityZeroShotModelId;
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
								this.settings.similarityZeroShotModelId = NO_SIMILARITY_MODEL;
								await this.saveSettings();
								refreshSettingsUi();
							} catch {
								// ignore
							}
						}
					}
				}
				try {
					(this as unknown as SettingsHandlerRuntime).termSimilarityLoaded = false;
					(this as unknown as SettingsHandlerRuntime).termSimilarityIndex = null;
					(this as unknown as SettingsHandlerRuntime).termSimilarityPendingFiles = new Set<string>();
					(this as unknown as SettingsHandlerRuntime).termSimilarityQueueTotal = 0;
					(this as unknown as SettingsHandlerRuntime).termSimilarityQueueProcessed = 0;
				} catch {
					// ignore
				}
				// Clear existing topic classifications so the new model can repopulate them.
				try {
					await writeTermStore(this, { model: "zeroshot", files: {} });
				} catch {
					// ignore
				}
				try {
					await (this as unknown as SettingsHandlerRuntime).reloadTermSimilaritiesFromDisk?.();
				} catch {
					// ignore
				}
				try {
					(this as unknown as SettingsHandlerRuntime).scheduleMissingTopicClassificationSweep?.("similarityZeroShotModelId");
				} catch {
					// ignore
				}
				try {
					await (this as unknown as SettingsHandlerRuntime).recomputeInheritedMarksNow?.(key);
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
					await (this as unknown as SettingsHandlerRuntime).onSimilaritySettingsChanged?.(key);
				} catch {
					// ignore
				}
				try {
					await (this as unknown as SettingsHandlerRuntime).recomputeInheritedMarksNow?.(key);
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
					await (this as unknown as SettingsHandlerRuntime).onSimilaritySettingsChanged?.(key);
				} catch {
					// ignore
				}
				try {
					await (this as unknown as SettingsHandlerRuntime).recomputeInheritedMarksNow?.(key);
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
					await (this as unknown as SettingsHandlerRuntime).recomputeInheritedMarksNow?.(key);
				} catch {
					// ignore
				}
				this.refreshEpochViews();
			})();
		}

		if (key === "generateEpochs") {
			if (!isGenerateEpochsEffective(this)) {
				if (this.viewPreferences.showEpochsView) {
					this.viewPreferences.showEpochsView = false;
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
					updateAggregatedEntriesInternal(this.indexer as unknown as IndexerPipeline, p, { skipSort: true });
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
				(this as unknown as SettingsHandlerRuntime).refreshAiBridgeStatusBar?.();
			} catch {
				// ignore
			}
			return;
		}

		if (key === "openAiBridgeInObsidianWebViewer") {
			try {
				(this as unknown as SettingsHandlerRuntime).refreshAiBridgeStatusBar?.();
			} catch {
				// ignore
			}
			return;
		}

		if (
			key === "calendarSyncIcsUrls" ||
			key === "calendarSyncPeriod" ||
			key === "calendarSyncFolder" ||
			key === "calendarSyncTemplatePath"
		) {
			try {
				(this as unknown as SettingsHandlerRuntime).refreshCalendarSyncSchedule?.();
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
