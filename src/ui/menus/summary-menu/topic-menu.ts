import { Menu, Notice, Platform } from "obsidian";
import {
	canonicalizeTopicTerm,
	isNoTopicSentinel,
	sortTopicTermsIgnorePrefix
} from "utils";
import type { DateEntry } from "../../../indexer/types";
import type { CanvasMenuState } from "../menu-state";
import { getTopicGroupForPath } from "./topic-group";
import { promptEditTopic } from "../../modals/topic-edit-modal";
import type { TopicEditResult } from "../../modals/topic-edit-modal";
import { hasSimilarityAccess } from "../../../plugin/pro-feature-state";
import { isTopicSimilarityEnabled } from "../../../plugin/similarity/config";

type TopicPluginLike = CanvasMenuState["plugin"] & {
	indexer?: {
		getIndexedPaths?: () => unknown;
		getFileEmbeddingTerm?: (path: string) => unknown;
		setFileEmbeddingTerm?: (path: string, value: string) => boolean;
	};
	termSimilarityIndex?: { files?: Record<string, { term?: unknown } | undefined> };
	ensureTermSimilarityStoreLoaded?: () => Promise<void>;
	removeTermSimilarity?: (path: string) => Promise<void>;
	renameTopicGroup?: (from: string, to: string) => Promise<void>;
	queueVectorUpdate?: (path: string) => void;
	queueTermSimilarityUpdate?: (path: string) => void;
	scheduleMissingTopicClassificationSweep?: (reason: string) => void;
	scheduleInheritedMarkRecompute?: (reason: string) => void;
	persistIndex?: (options: { skipEnsure?: boolean }) => Promise<void>;
	refreshEpochViews?: () => void;
	app?: { workspace?: { getActiveFile?: () => { path?: string } | null } };
};

type TopicMenuState = CanvasMenuState & {
	plugin: TopicPluginLike;
	__suppressExternalAutoScrollUntil?: number;
	suppressNextFocusScrollForPath?: (path: string | null) => void;
};

function isTopicEditResult(value: TopicEditResult | null): value is TopicEditResult {
	return value != null;
}

async function listKnownTopics(state: TopicMenuState): Promise<string[]> {
	const plugin = state.plugin;
	if (!hasSimilarityAccess(plugin)) return [];
	if (!isTopicSimilarityEnabled(plugin)) return [];
	const indexer = plugin?.indexer;
	try {
		await plugin.ensureTermSimilarityStoreLoaded?.();
	} catch { void 0; }
	const topics = new Set<string>();
	try {
		const indexedPaths: unknown = indexer?.getIndexedPaths?.();
		const list = Array.isArray(indexedPaths) ? indexedPaths : [];
		for (const p of list) {
			if (!p || typeof p !== "string" || p.startsWith("epoch://")) continue;
			const t0 = String(indexer?.getFileEmbeddingTerm?.(p) || "").trim();
			const t = canonicalizeTopicTerm(t0);
			if (t && !isNoTopicSentinel(t)) topics.add(t);
		}
	} catch { void 0; }
	try {
		const filesObj = plugin?.termSimilarityIndex?.files;
		if (filesObj && typeof filesObj === "object") {
			for (const v of Object.values(filesObj)) {
				const termValue = v?.term;
				const t0 = typeof termValue === "string" ? termValue.trim() : "";
				const t = canonicalizeTopicTerm(t0);
				if (t && !isNoTopicSentinel(t)) topics.add(t);
			}
		}
	} catch { void 0; }
	return Array.from(topics).sort(sortTopicTermsIgnorePrefix);
}

export function addEditTopic(menu: Menu, state: CanvasMenuState, entry: DateEntry, title: string): void {
	try {
		const menuState = state as TopicMenuState;
		const plugin = menuState.plugin;
		const topicsEnabled = isTopicSimilarityEnabled(plugin);
		const isPro = hasSimilarityAccess(plugin);
		const enabled = isPro && topicsEnabled;
		if (!enabled) return;
		if (!Platform.isMobileApp) menu.addSeparator();
		menu.addItem((item) => {
			item
				.setTitle("Set topic…")
				.setIcon("tag")
				.setDisabled(false)
				.onClick(async () => {
					if (!topicsEnabled) return;
					// Avoid jumping the canvas to the currently-open note when this modal closes.
					// This can happen because the active file regains focus after SuggestModal resolves.
					try {
						menuState.__suppressExternalAutoScrollUntil = (window.performance?.now?.() ?? Date.now()) + 1000;
						const activePath = plugin?.app?.workspace?.getActiveFile?.()?.path ?? null;
						menuState.suppressNextFocusScrollForPath?.(activePath);
					} catch { void 0; }

					const queueNotice = (): void => {
						try {
							new Notice("Epochgram: Topic update queued", 1500);
						} catch {
							// ignore
						}
					};
					if (!hasSimilarityAccess(plugin)) {
						state.requirePro("Similarity");
						return;
					}
					const indexer = plugin?.indexer;
					if (!indexer) return;

					const group = await getTopicGroupForPath(state, entry.file);
					const inferred = canonicalizeTopicTerm(String(group?.term || "").trim());
					const existingRaw = String(indexer.getFileEmbeddingTerm(entry.file) || "").trim();
					const existingCanon = canonicalizeTopicTerm(existingRaw);
					const existing = !!existingCanon && !isNoTopicSentinel(existingCanon) ? existingCanon : "";
					const initialValue = existing || inferred;

					const topics = await listKnownTopics(state);
					if (inferred && !topics.includes(inferred) && !isNoTopicSentinel(inferred)) topics.unshift(inferred);

					const res = await promptEditTopic(plugin.app, {
						title: `Edit topic ${title}`,
						initialValue,
						topics,
						maxWords: 12,
						maxChars: 140
					});
					if (!isTopicEditResult(res)) return;

					if (res.action === "remove-topic") {
						const topic = String(res.topic || "").trim();
						if (topic && typeof plugin.renameTopicGroup === "function") {
							try {
								await plugin.renameTopicGroup(topic, "");
							} catch { void 0; }
							try {
								queueNotice();
								plugin.scheduleMissingTopicClassificationSweep?.("topic-remove");
							} catch { void 0; }
						}
						try {
							plugin.refreshEpochViews?.();
						} catch { void 0; }
						state.clearHover(true);
						state.refreshIndex();
						return;
					}

					if (res.action === "clear") {
						const hasAnyTopicNow = !!existing || !!inferred;
						if (!hasAnyTopicNow) return;

						let changed = false;
						try {
							changed = !!indexer.setFileEmbeddingTerm?.(entry.file, "") || changed;
						} catch {
							// ignore
						}
						try {
							await plugin.removeTermSimilarity?.(entry.file);
						} catch {
							// ignore
						}
						try {
							queueNotice();
							plugin.queueVectorUpdate?.(entry.file);
						} catch { void 0; }
						try {
							plugin.scheduleInheritedMarkRecompute?.("topic-clear");
						} catch { void 0; }
						if (changed) {
							if (typeof plugin?.persistIndex === "function") await plugin.persistIndex({ skipEnsure: true });
						}
						try {
							plugin.refreshEpochViews?.();
						} catch { void 0; }
						state.clearHover(true);
						state.refreshIndex();
						return;
					}

					const value = canonicalizeTopicTerm(String(res.value ?? "").trim());
					const next = value;
					if (!next || isNoTopicSentinel(next)) return;

					const hasExisting = !!existing;
					const wantsRename =
						hasExisting &&
						existing !== next &&
						typeof plugin.renameTopicGroup === "function";
					if (wantsRename) {
						await plugin.renameTopicGroup(existing, next);
						try {
							queueNotice();
							plugin.scheduleMissingTopicClassificationSweep?.("topic-rename");
						} catch { void 0; }
					} else {
						if (!indexer.setFileEmbeddingTerm(entry.file, next)) return;
						try {
							queueNotice();
							plugin.queueVectorUpdate?.(entry.file);
						} catch { void 0; }
						try {
							plugin.queueTermSimilarityUpdate?.(entry.file);
						} catch { void 0; }
						try {
							plugin.scheduleMissingTopicClassificationSweep?.("topic-vocab");
						} catch { void 0; }
						try {
							plugin.scheduleInheritedMarkRecompute?.("topic-change");
						} catch { void 0; }
						if (typeof plugin?.persistIndex === "function") await plugin.persistIndex({ skipEnsure: true });
					}

					try {
						plugin.refreshEpochViews?.();
					} catch { void 0; }
					state.clearHover(true);
					state.refreshIndex();
				});
		});
	} catch { void 0; }
}
