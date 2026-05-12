import { Notice, Platform } from "obsidian";
import type { EpochPlugin } from "../main";
import { setCssStyles } from "../dom";

type EpochProgressKind = "index" | "search" | "semantic" | "topics" | "semanticBuild" | "ai";

const KIND_PRIORITY: EpochProgressKind[] = ["ai", "topics", "semantic", "semanticBuild", "index", "search"];

function clearPlannedAiWork(plugin: EpochPlugin): void {
	try {
		const anyPlugin: any = plugin as any;
		const g: any = globalThis as any;

		try {
			anyPlugin.__epochAiEnqueueCancelKey = (Number(anyPlugin.__epochAiEnqueueCancelKey) || 0) + 1;
		} catch {
			// ignore
		}

		try {
			anyPlugin.aiSummaryPendingFiles = new Set<string>();
			anyPlugin.aiSummaryQueueRunning = false;
		} catch {
			// ignore
		}

		if (anyPlugin?.epochRegenAfterAiTimer != null) {
			try {
				g?.clearInterval?.(anyPlugin.epochRegenAfterAiTimer);
			} catch {
				// ignore
			}
			anyPlugin.epochRegenAfterAiTimer = null;
		}
		anyPlugin.epochRegenAfterAiMode = null;
		anyPlugin.epochRegenAfterAiAll = false;
		anyPlugin.epochRegenAfterAiDateKeys = null;
		anyPlugin.epochRegenAfterAiBuckets = null;
		anyPlugin.epochRegenAfterAiBucketsQueue = null;
		anyPlugin.epochRegenAfterAiShowQueuedNotice = false;
		anyPlugin.__epochEpochHierarchyTotalJobs = 0;
		anyPlugin.__epochEpochHierarchyTotalTokens = 0;
		anyPlugin.__epochEpochHierarchyRunKey = 0;
		anyPlugin.__epochAiEpochsProgressStartedAt = 0;
		anyPlugin.__epochAiEpochsProgressBaselineDone = 0;
		anyPlugin.__epochAiEpochsProgressBaselineErrors = 0;

		const throttle: any = anyPlugin?.aiSummaryEnqueueThrottleByFile;
		if (throttle && typeof throttle?.values === "function" && typeof throttle?.clear === "function") {
			try {
				for (const st of throttle.values()) {
					try {
						if (st?.timerId != null) g?.clearTimeout?.(st.timerId);
					} catch {
						// ignore
					}
					try {
						if (st) {
							st.timerId = null;
							st.pendingJobs = null;
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
			anyPlugin?.aiBridgeChunkGroups?.clear?.();
		} catch {
			// ignore
		}
		try {
			anyPlugin?.aiBridgeReduceFallbackByJobId?.clear?.();
		} catch {
			// ignore
		}
	} catch {
		// ignore
	}
}

function getProgressParts(plugin: EpochPlugin): { root: HTMLElement; text: HTMLElement } | null {
	const root = getProgressEl(plugin);
	if (!root) return null;
	const anyPlugin: any = plugin as any;
	if (anyPlugin.__epochStatusBarProgressTextEl instanceof HTMLElement) {
		return {
			root,
			text: anyPlugin.__epochStatusBarProgressTextEl
		};
	}

	try {
		root.textContent = "";
		const text = document.createElement("span");
		text.addClass?.("epoch-status-progress-text");
		try {
			if (!anyPlugin.__epochStatusBarProgressClickBound) {
				anyPlugin.__epochStatusBarProgressClickBound = true;
				root.addEventListener("click", (ev) => {
					ev.preventDefault();
					ev.stopPropagation();
					try {
						const kind: EpochProgressKind | "" = String((anyPlugin.__epochActiveProgressKind ?? "") as any) as any;
						if (!kind) return;
						requestCancelEpochTask(plugin, kind as EpochProgressKind);
					} catch {
						// ignore
					}
				});
			}
		} catch {
			// ignore
		}

		root.appendChild(text);
		anyPlugin.__epochStatusBarProgressTextEl = text;
		return { root, text };
	} catch {
		return { root, text: root };
	}
}

export function consumeCancelRequested(plugin: EpochPlugin, kind: EpochProgressKind): boolean {
	try {
		const anyPlugin: any = plugin as any;
		const map: Record<string, number> =
			anyPlugin.__epochCancelRequestedAt && typeof anyPlugin.__epochCancelRequestedAt === "object"
				? anyPlugin.__epochCancelRequestedAt
				: (anyPlugin.__epochCancelRequestedAt = {});
		const had = typeof map[kind] === "number" && map[kind] > 0;
		delete map[kind];
		return had;
	} catch {
		return true;
	}
}

export function requestCancelEpochTask(plugin: EpochPlugin, kind: EpochProgressKind): void {
	if (!Platform.isDesktopApp) return;
	try {
		const anyPlugin: any = plugin as any;
		const map: Record<string, number> =
			anyPlugin.__epochCancelRequestedAt && typeof anyPlugin.__epochCancelRequestedAt === "object"
				? anyPlugin.__epochCancelRequestedAt
				: (anyPlugin.__epochCancelRequestedAt = {});
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
		const anyPlugin: any = plugin as any;
		if (kind === "ai") {
			clearPlannedAiWork(plugin);
			try {
				anyPlugin.aiBridge?.clearQueue?.();
			} catch {
				// ignore
			}
			try {
				anyPlugin.__epochAiProgressStartedAt = 0;
				anyPlugin.__epochAiProgressBaselineDone = null;
				anyPlugin.__epochAiProgressBaselineErrors = null;
			} catch {
				// ignore
			}
			try {
				delete (anyPlugin as any)?.__epochCancelRequestedAt?.ai;
			} catch {
				// ignore
			}
			try {
				void anyPlugin.refreshAiBridgeStatusBar?.();
			} catch {
				// ignore
			}
			try {
				void anyPlugin.refreshAiBridgeProgress?.();
			} catch {
				// ignore
			}
		}
		if (kind === "semantic") {
			try {
				if (anyPlugin.similarityQueueTimer) {
					clearTimeout(anyPlugin.similarityQueueTimer);
					anyPlugin.similarityQueueTimer = null;
				}
			} catch {
				// ignore
			}
			try {
				anyPlugin.similarityPendingFiles = new Set<string>();
				anyPlugin.similarityQueueTotal = 0;
				anyPlugin.similarityQueueProcessed = 0;
				anyPlugin.similarityVectorUpdateProcessingStartedAt = 0;
			} catch {
				// ignore
			}
			try {
				delete (anyPlugin as any)?.__epochCancelRequestedAt?.semantic;
			} catch {
				// ignore
			}
		}
		if (kind === "topics") {
			try {
				if (anyPlugin.termSimilarityQueueTimer) {
					clearTimeout(anyPlugin.termSimilarityQueueTimer);
					anyPlugin.termSimilarityQueueTimer = null;
				}
			} catch {
				// ignore
			}
			try {
				anyPlugin.termSimilarityPendingFiles = new Set<string>();
				anyPlugin.termSimilarityQueueTotal = 0;
				anyPlugin.termSimilarityQueueProcessed = 0;
				anyPlugin.termSimilarityProcessingStartedAt = 0;
			} catch {
				// ignore
			}
			try {
				delete (anyPlugin as any)?.__epochCancelRequestedAt?.topics;
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

function 	getProgressEl(plugin: EpochPlugin): HTMLElement | null {
	if (!Platform.isDesktopApp) return null;
	const anyPlugin: any = plugin as any;
	if (anyPlugin.__epochStatusBarProgressEl instanceof HTMLElement) return anyPlugin.__epochStatusBarProgressEl;
	try {
		if (typeof (plugin as any).addStatusBarItem !== "function") return null;
		const el: HTMLElement = (plugin as any).addStatusBarItem();
		setCssStyles(el, { display: "none" });
		el.addClass?.("epoch-status-progress");
		try {
			el.setAttribute("aria-label", "Epochgram progress");
			el.setAttribute("data-tooltip-position", "top");
		} catch {
			// ignore
		}
		anyPlugin.__epochStatusBarProgressEl = el;
		return el;
	} catch {
		return null;
	}
}

function refreshDisplay(plugin: EpochPlugin): void {
	const parts = getProgressParts(plugin);
	if (!parts) return;
	const el = parts.root;
	const anyPlugin: any = plugin as any;
	const map: Record<string, string> = (anyPlugin.__epochProgressByKind && typeof anyPlugin.__epochProgressByKind === "object")
		? anyPlugin.__epochProgressByKind
		: (anyPlugin.__epochProgressByKind = {});

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
			(anyPlugin.__epochActiveProgressKind as any) = "";
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
			(el.style as any).cursor = "";
		} catch {
			// ignore
		}
		setCssStyles(el, { display: "none" });
		return;
	}
	try {
		(anyPlugin.__epochActiveProgressKind as any) = activeKind;
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
		(el.style as any).cursor = activeKind ? "pointer" : "";
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
	const anyPlugin: any = plugin as any;

	try {
		if (anyPlugin.__epochProgressClearTimer != null) {
			window.clearTimeout(anyPlugin.__epochProgressClearTimer);
			anyPlugin.__epochProgressClearTimer = null;
		}
	} catch {
		// ignore
	}

	const map: Record<string, string> = (anyPlugin.__epochProgressByKind && typeof anyPlugin.__epochProgressByKind === "object")
		? anyPlugin.__epochProgressByKind
		: (anyPlugin.__epochProgressByKind = {});
	map[kind] = String(text || "").trim();
	refreshDisplay(plugin);
}

export function cancelEpochDesktopTaskAnnouncement(plugin: EpochPlugin, key: string): void {
	if (!Platform.isDesktopApp) return;
	try {
		const anyPlugin: any = plugin as any;
		const timers: Record<string, number> =
			anyPlugin.__epochDesktopTaskNoticeTimer && typeof anyPlugin.__epochDesktopTaskNoticeTimer === "object"
				? anyPlugin.__epochDesktopTaskNoticeTimer
				: (anyPlugin.__epochDesktopTaskNoticeTimer = {});
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
	if (!Platform.isDesktopApp) return;
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
	if (!Platform.isDesktopApp) return;
	const anyPlugin: any = plugin as any;
	const map: Record<string, string> = (anyPlugin.__epochProgressByKind && typeof anyPlugin.__epochProgressByKind === "object")
		? anyPlugin.__epochProgressByKind
		: (anyPlugin.__epochProgressByKind = {});
	map[kind] = "";
	refreshDisplay(plugin);

	try {
		if (anyPlugin.__epochProgressClearTimer != null) {
			window.clearTimeout(anyPlugin.__epochProgressClearTimer);
			anyPlugin.__epochProgressClearTimer = null;
		}
		anyPlugin.__epochProgressClearTimer = window.setTimeout(() => {
			try {
				anyPlugin.__epochProgressClearTimer = null;
				refreshDisplay(plugin);
			} catch {
				// ignore
			}
		}, Math.max(0, Math.floor(delayMs)));
	} catch {
		// ignore
	}
}
