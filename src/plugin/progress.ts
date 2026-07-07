import { Notice, Platform } from "obsidian";
import type { EpochPlugin } from "../main";
import { setCssStyles } from "../dom";

export type EpochProgressKind = "index" | "search" | "semantic" | "topics" | "semanticBuild" | "ai";

const KIND_PRIORITY: EpochProgressKind[] = ["ai", "topics", "semantic", "semanticBuild", "index", "search"];

type ProgressByKind = Partial<Record<EpochProgressKind, string>>;
type CancelRequestedMap = Partial<Record<EpochProgressKind, number>>;
type NoticeTimerMap = Record<string, number>;

type AiEnqueueThrottleState = {
	timerId?: unknown;
	pendingJobs?: unknown;
};

type AiEnqueueThrottleMap = {
	values: () => Iterable<unknown>;
	clear: () => void;
};

type ProgressRuntime = {
	__epochAiEnqueueCancelKey?: number;
	aiSummaryPendingFiles?: Set<string>;
	aiSummaryQueueRunning?: boolean;
		epochRegenAfterAiTimer?: unknown;
	epochRegenAfterAiMode?: unknown;
	epochRegenAfterAiAll?: boolean;
	epochRegenAfterAiDateKeys?: unknown;
	epochRegenAfterAiBuckets?: unknown;
	epochRegenAfterAiBucketsQueue?: unknown;
	epochRegenAfterAiShowQueuedNotice?: boolean;
	__epochEpochHierarchyTotalJobs?: number;
	__epochEpochHierarchyTotalTokens?: number;
	__epochEpochHierarchyRunKey?: number;
	__epochAiEpochsProgressStartedAt?: number;
	__epochAiEpochsProgressBaselineDone?: number;
	__epochAiEpochsProgressBaselineErrors?: number;
	aiSummaryEnqueueThrottleByFile?: AiEnqueueThrottleMap;
	aiBridgeChunkGroups?: { clear?: () => void };
	aiBridgeReduceFallbackByJobId?: { clear?: () => void };
	__epochStatusBarProgressTextEl?: HTMLElement;
	__epochStatusBarProgressClickBound?: boolean;
	__epochActiveProgressKind?: EpochProgressKind | "";
	__epochCancelRequestedAt?: CancelRequestedMap;
	aiBridge?: { clearQueue?: () => void };
	__epochAiProgressStartedAt?: number;
	__epochAiProgressBaselineDone?: number | null;
	__epochAiProgressBaselineErrors?: number | null;
	refreshAiBridgeStatusBar?: () => unknown;
	refreshAiBridgeProgress?: () => unknown;
	similarityQueueTimer?: number | null;
	similarityPendingFiles?: Set<string>;
	similarityQueueTotal?: number;
	similarityQueueProcessed?: number;
	similarityVectorUpdateProcessingStartedAt?: number;
	termSimilarityQueueTimer?: number | null;
	termSimilarityPendingFiles?: Set<string>;
	termSimilarityQueueTotal?: number;
	termSimilarityQueueProcessed?: number;
	termSimilarityProcessingStartedAt?: number;
	__epochStatusBarProgressEl?: HTMLElement;
	__epochProgressByKind?: ProgressByKind;
	__epochProgressClearTimer?: number | null;
	__epochDesktopTaskNoticeTimer?: NoticeTimerMap;
};

function getRuntime(plugin: EpochPlugin): ProgressRuntime {
	return plugin as unknown as ProgressRuntime;
}

function ensureCancelMap(runtime: ProgressRuntime): CancelRequestedMap {
	if (!runtime.__epochCancelRequestedAt || typeof runtime.__epochCancelRequestedAt !== "object") {
		runtime.__epochCancelRequestedAt = {};
	}
	return runtime.__epochCancelRequestedAt;
}

function ensureProgressMap(runtime: ProgressRuntime): ProgressByKind {
	if (!runtime.__epochProgressByKind || typeof runtime.__epochProgressByKind !== "object") {
		runtime.__epochProgressByKind = {};
	}
	return runtime.__epochProgressByKind;
}

function ensureNoticeTimers(runtime: ProgressRuntime): NoticeTimerMap {
	if (!runtime.__epochDesktopTaskNoticeTimer || typeof runtime.__epochDesktopTaskNoticeTimer !== "object") {
		runtime.__epochDesktopTaskNoticeTimer = {};
	}
	return runtime.__epochDesktopTaskNoticeTimer;
}

function clearPlannedAiWork(plugin: EpochPlugin): void {
	try {
		const runtime = getRuntime(plugin);

		try {
			runtime.__epochAiEnqueueCancelKey = (Number(runtime.__epochAiEnqueueCancelKey) || 0) + 1;
		} catch {
			// ignore
		}

		try {
			runtime.aiSummaryPendingFiles = new Set<string>();
			runtime.aiSummaryQueueRunning = false;
		} catch {
			// ignore
		}

		if (runtime.epochRegenAfterAiTimer != null) {
			try {
				(window.clearInterval as unknown as (id: unknown) => void)(runtime.epochRegenAfterAiTimer);
			} catch {
				// ignore
			}
			runtime.epochRegenAfterAiTimer = null;
		}
		runtime.epochRegenAfterAiMode = null;
		runtime.epochRegenAfterAiAll = false;
		runtime.epochRegenAfterAiDateKeys = null;
		runtime.epochRegenAfterAiBuckets = null;
		runtime.epochRegenAfterAiBucketsQueue = null;
		runtime.epochRegenAfterAiShowQueuedNotice = false;
		runtime.__epochEpochHierarchyTotalJobs = 0;
		runtime.__epochEpochHierarchyTotalTokens = 0;
		runtime.__epochEpochHierarchyRunKey = 0;
		runtime.__epochAiEpochsProgressStartedAt = 0;
		runtime.__epochAiEpochsProgressBaselineDone = 0;
		runtime.__epochAiEpochsProgressBaselineErrors = 0;

		const throttle = runtime.aiSummaryEnqueueThrottleByFile;
		if (throttle && typeof throttle.values === "function" && typeof throttle.clear === "function") {
			try {
				for (const st of throttle.values()) {
					try {
						if (typeof st === "object" && st !== null) {
							const state = st as AiEnqueueThrottleState;
							if (state.timerId != null) {
								(window.clearTimeout as unknown as (id: unknown) => void)(state.timerId);
							}
						}
					} catch {
						// ignore
					}
					try {
						if (typeof st === "object" && st !== null) {
							const state = st as AiEnqueueThrottleState;
							state.timerId = null;
							state.pendingJobs = null;
						}
					} catch {
						// ignore
					}
				}
				throttle.clear();
			} catch {
				// ignore
			}
		}

		try {
			runtime.aiBridgeChunkGroups?.clear?.();
		} catch {
			// ignore
		}
		try {
			runtime.aiBridgeReduceFallbackByJobId?.clear?.();
		} catch {
			// ignore
		}
	} catch {
		// ignore
	}
}

function isHtmlElement(value: unknown): value is HTMLElement {
	return typeof HTMLElement !== "undefined" && value instanceof HTMLElement;
}

function getProgressParts(plugin: EpochPlugin): { root: HTMLElement; text: HTMLElement } | null {
	const root = getProgressEl(plugin);
	if (!root) return null;
	const runtime = getRuntime(plugin);
	if (isHtmlElement(runtime.__epochStatusBarProgressTextEl)) {
		return {
			root,
			text: runtime.__epochStatusBarProgressTextEl
		};
	}

	try {
		root.textContent = "";
		const text = root.createSpan({ cls: "epoch-status-progress-text" });
		try {
			if (!runtime.__epochStatusBarProgressClickBound) {
				runtime.__epochStatusBarProgressClickBound = true;
				root.addEventListener("click", (ev) => {
					ev.preventDefault();
					ev.stopPropagation();
					try {
						const kind = runtime.__epochActiveProgressKind;
						if (!kind) return;
						requestCancelEpochTask(plugin, kind);
					} catch {
						// ignore
					}
				});
			}
		} catch {
			// ignore
		}

		root.appendChild(text);
		runtime.__epochStatusBarProgressTextEl = text;
		return { root, text };
	} catch {
		return { root, text: root };
	}
}

export function consumeCancelRequested(plugin: EpochPlugin, kind: EpochProgressKind): boolean {
	try {
		const runtime = getRuntime(plugin);
		const map = ensureCancelMap(runtime);
		const had = typeof map[kind] === "number" && map[kind] > 0;
		delete map[kind];
		return had;
	} catch {
		return true;
	}
}

export function requestCancelEpochTask(plugin: EpochPlugin, kind: EpochProgressKind): void {
	if (!Platform.isDesktop) return;
	try {
		const runtime = getRuntime(plugin);
		const map = ensureCancelMap(runtime);
		map[kind] = Date.now();
	} catch {
		// ignore
	}

	try {
		if (kind === "semantic") cancelEpochDesktopTaskAnnouncement(plugin, "semantic:queued");
		if (kind === "topics") cancelEpochDesktopTaskAnnouncement(plugin, "topics:queued");
		if (kind === "semanticBuild") cancelEpochDesktopTaskAnnouncement(plugin, "semanticBuild:started");
	} catch {
		// ignore
	}

	// Best-effort immediate actions.
	try {
		const runtime = getRuntime(plugin);
		if (kind === "ai") {
			clearPlannedAiWork(plugin);
			try {
			runtime.aiBridge?.clearQueue?.();
			} catch {
				// ignore
			}
			try {
				runtime.__epochAiProgressStartedAt = 0;
				runtime.__epochAiProgressBaselineDone = null;
				runtime.__epochAiProgressBaselineErrors = null;
			} catch {
				// ignore
			}
			try {
				delete ensureCancelMap(runtime).ai;
			} catch {
				// ignore
			}
			try {
				void runtime.refreshAiBridgeStatusBar?.();
			} catch {
				// ignore
			}
			try {
				void runtime.refreshAiBridgeProgress?.();
			} catch {
				// ignore
			}
		}
		if (kind === "semantic") {
			try {
				if (typeof runtime.similarityQueueTimer === "number") {
					window.clearTimeout(runtime.similarityQueueTimer);
					runtime.similarityQueueTimer = null;
				}
			} catch {
				// ignore
			}
			try {
				runtime.similarityPendingFiles = new Set<string>();
				runtime.similarityQueueTotal = 0;
				runtime.similarityQueueProcessed = 0;
				runtime.similarityVectorUpdateProcessingStartedAt = 0;
			} catch {
				// ignore
			}
			try {
				delete ensureCancelMap(runtime).semantic;
			} catch {
				// ignore
			}
		}
		if (kind === "topics") {
			try {
				if (typeof runtime.termSimilarityQueueTimer === "number") {
					window.clearTimeout(runtime.termSimilarityQueueTimer);
					runtime.termSimilarityQueueTimer = null;
				}
			} catch {
				// ignore
			}
			try {
				runtime.termSimilarityPendingFiles = new Set<string>();
				runtime.termSimilarityQueueTotal = 0;
				runtime.termSimilarityQueueProcessed = 0;
				runtime.termSimilarityProcessingStartedAt = 0;
			} catch {
				// ignore
			}
			try {
				delete ensureCancelMap(runtime).topics;
			} catch {
				// ignore
			}
		}
	} catch {
		// ignore
	}

	try {
		clearEpochProgress(plugin, kind, 0);
	} catch {
		// ignore
	}

	try {
		new Notice("Canceled", 2500);
	} catch {
		// ignore
	}
}

function getProgressEl(plugin: EpochPlugin): HTMLElement | null {
	if (!Platform.isDesktop) return null;
	const runtime = getRuntime(plugin);
	if (isHtmlElement(runtime.__epochStatusBarProgressEl)) return runtime.__epochStatusBarProgressEl;
	try {
		const el = plugin.addStatusBarItem();
		setCssStyles(el, { display: "none" });
		el.addClass?.("epoch-status-progress");
		try {
			el.setAttribute("aria-label", "Epochgram progress");
			el.setAttribute("data-tooltip-position", "top");
		} catch {
			// ignore
		}
		runtime.__epochStatusBarProgressEl = el;
		return el;
	} catch {
		return null;
	}
}

function refreshDisplay(plugin: EpochPlugin): void {
	const parts = getProgressParts(plugin);
	if (!parts) return;
	const el = parts.root;
	const runtime = getRuntime(plugin);
	const map = ensureProgressMap(runtime);

	let nextText = "";
	let activeKind: EpochProgressKind | "" = "";
	for (const k of KIND_PRIORITY) {
		const t = typeof map[k] === "string" ? String(map[k]).trim() : "";
		if (t) {
			nextText = t;
			activeKind = k;
			break;
		}
	}

	if (!nextText) {
		try {
			runtime.__epochActiveProgressKind = "";
		} catch {
			// ignore
		}
		parts.text.textContent = "";
		try {
			el.setAttribute("aria-label", "");
		} catch {
			// ignore
		}
		try {
			setCssStyles(el, { cursor: "" });
		} catch {
			// ignore
		}
		setCssStyles(el, { display: "none" });
		return;
	}
	try {
		runtime.__epochActiveProgressKind = activeKind;
	} catch {
		// ignore
	}
	parts.text.textContent = nextText;
	try {
		const allProgresses: string[] = [];
		for (const k of KIND_PRIORITY) {
			const t = typeof map[k] === "string" ? String(map[k]).trim() : "";
			if (t) allProgresses.push(t);
		}
		el.setAttribute("aria-label", allProgresses.join("\n"));
	} catch {
		// ignore
	}
	try {
		setCssStyles(el, { cursor: activeKind ? "pointer" : "" });
	} catch {
		// ignore
	}
	setCssStyles(el, { display: "" });
}

export function initEpochStatusBarProgress(plugin: EpochPlugin): void {
	// Create the element early so subsequent updates are cheap.
	getProgressEl(plugin);
}

export function setEpochProgress(plugin: EpochPlugin, kind: EpochProgressKind, text: string): void {
	const el = getProgressEl(plugin);
	if (!el) return;
	const runtime = getRuntime(plugin);

	try {
		if (typeof runtime.__epochProgressClearTimer === "number") {
			window.clearTimeout(runtime.__epochProgressClearTimer);
			runtime.__epochProgressClearTimer = null;
		}
	} catch {
		// ignore
	}

	const map = ensureProgressMap(runtime);
	map[kind] = String(text || "").trim();
	refreshDisplay(plugin);
}

export function cancelEpochDesktopTaskAnnouncement(plugin: EpochPlugin, key: string): void {
	if (!Platform.isDesktop) return;
	try {
		const runtime = getRuntime(plugin);
		const timers = ensureNoticeTimers(runtime);
		const t = timers[key];
		if (typeof t === "number") {
			window.clearTimeout(t);
			delete timers[key];
		}
	} catch {
		// ignore
	}
}

export function announceEpochDesktopTaskAfter(
	plugin: EpochPlugin,
	key: string,
	message: string,
	options?: {
		graceMs?: number;
		timeoutMs?: number;
		minIntervalMs?: number;
		still?: () => boolean;
	}
): void {
	// Delayed desktop task notices are intentionally disabled.
	// (Implementation preserved below for potential future re-enable.)
	void plugin;
	void key;
	void message;
	void options;
	return;
	/*
	if (!Platform.isDesktop) return;
	const msg = String(message || "").trim();
	if (!msg) return;

	const graceMs = Math.max(0, Math.floor(options?.graceMs ?? 5000));
	const timeoutMs = Math.max(500, Math.floor(options?.timeoutMs ?? 2500));
	const minIntervalMs = Math.max(0, Math.floor(options?.minIntervalMs ?? 8000));

	if (!shouldAnnounce(plugin, key, minIntervalMs)) return;

	cancelEpochDesktopTaskAnnouncement(plugin, key);

	try {
		const anyPlugin: any = plugin as any;
		const timers: Record<string, number> =
			anyPlugin.__epochDesktopTaskNoticeTimer && typeof anyPlugin.__epochDesktopTaskNoticeTimer === "object"
				? anyPlugin.__epochDesktopTaskNoticeTimer
				: (anyPlugin.__epochDesktopTaskNoticeTimer = {});
		timers[key] = window.setTimeout(() => {
			try {
				delete timers[key];
			} catch {
				// ignore
			}
			try {
				if (typeof options?.still === "function" && !options.still()) return;
			} catch {
				// ignore
			}
			try {
				new Notice(msg, timeoutMs);
			} catch {
				// ignore
			}
		}, graceMs);
	} catch {
		// ignore
	}
	*/
}

export function clearEpochProgress(plugin: EpochPlugin, kind: EpochProgressKind, delayMs: number = 1500): void {
	if (!Platform.isDesktop) return;
	const runtime = getRuntime(plugin);
	const map = ensureProgressMap(runtime);
	map[kind] = "";
	refreshDisplay(plugin);

	try {
		if (typeof runtime.__epochProgressClearTimer === "number") {
			window.clearTimeout(runtime.__epochProgressClearTimer);
			runtime.__epochProgressClearTimer = null;
		}
		runtime.__epochProgressClearTimer = window.setTimeout(() => {
			try {
				runtime.__epochProgressClearTimer = null;
				refreshDisplay(plugin);
			} catch {
				// ignore
			}
		}, Math.max(0, Math.floor(delayMs)));
	} catch {
		// ignore
	}
}
