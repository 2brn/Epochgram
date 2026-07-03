import { MarkdownView, Platform, setIcon, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";
import type { EpochPlugin } from "../../main";

import { EpochCanvas } from "../epoch-canvas";
import {
	createFilterButton,
	createFilterToggle,
	updateFilterPanelState
} from "../epoch-view/filter-ui";

function nowMs(): number {
	return window.performance?.now?.() ?? Date.now();
}

type LifecycleViewLike = {
	openedAt: number;
	startupRefocusDone: boolean;
	container: HTMLElement;
	contentEl: HTMLElement;
	rootEl: HTMLElement | null;
	controlsEl: HTMLElement | null;
	filtersExpanded: boolean;
	buttonSettings: HTMLElement | null;
	filtersPanelEl: HTMLElement | null;
	buttonReview: HTMLElement | null;
	buttonEdits: HTMLElement | null;
	buttonParsed: HTMLElement | null;
	buttonAttachments: HTMLElement | null;
	buttonEpochs: HTMLElement | null;
	reviewFilterMode: "reviewed+draft" | "draft";
	showAttachments: boolean;
	showTrackedChanges: boolean;
	showContentDates: boolean;
	showPropDates: boolean;
	showEpochsView: boolean;
	searchQuery: string;
	searchControlEl: HTMLElement | null;
	searchControlIconEl: HTMLElement | null;
	searchControlTextEl: HTMLElement | null;
	searchControlResizeObserver: ResizeObserver | null;
	searchControlLayoutRaf: number | null;
	searchControlRefreshRaf: number | null;
	searchPersistTimer?: number | null;
	startupSnapPath: string | null;
	startupDeferredSnapPath: string | null;
	startupDeferredSnapUntil: number;
	activeFilePath: string | null;
	leaf: WorkspaceLeaf;
	plugin: EpochPlugin & {
		viewPreferences?: {
			showDraftsOnly?: boolean;
			showAttachments?: boolean;
			showTrackedChanges?: boolean;
			showParsed?: boolean;
			showEpochsView?: boolean;
		};
		notifyProFeature?: (message: string) => void;
		settings?: { parseDatesInFrontmatter?: boolean };
	};
	app: {
		workspace: {
			on: (event: string, cb: (...args: unknown[]) => unknown) => unknown;
			activeLeaf?: WorkspaceLeaf | null;
			getLeavesOfType?: (type: string) => WorkspaceLeaf[];
		};
		vault: {
			on: (event: string, cb: (...args: unknown[]) => unknown) => unknown;
			getAbstractFileByPath: (path: string) => TAbstractFile | null;
		};
	};
	canvas: (EpochCanvas & { onAfterDraw?: (() => void) | null }) | null;
	registerDomEvent: (el: HTMLElement, event: string, callback: (evt: Event) => void, options?: boolean | AddEventListenerOptions) => void;
	registerEvent: (ref: unknown) => void;
	setFiltersExpanded: (expanded: boolean) => void;
	isPro: () => boolean;
	isEpochsEnabled: () => boolean;
	cycleReviewFilterMode: () => void;
	setShowTrackedChanges: (value: boolean) => void;
	setShowContentDates: (value: boolean) => void;
	setShowAttachments: (value: boolean) => void;
	setShowEpochsView: (value: boolean) => void;
	updateFilterButtons: () => void;
	scheduleSearchControlRefresh: () => void;
	scheduleSearchControlLayout: () => void;
	openSearchModal: () => void;
	updateSearchControl: () => void;
	refreshSyncedEpochAvailability: () => void;
	updateActiveFile: (_leaf?: unknown, options?: { suppressFocus?: boolean }) => void;
	syncCanvasActiveFile: (file: TFile | null, options?: { suppressFocus?: boolean }) => void;
	updateProUiState: () => void;
	startStartupDefaultNoteRefocus: () => void;
	clearStartupRefocusTimer: () => void;
};

export async function epochViewOnOpen(_view: unknown): Promise<void> {
	const view = _view as LifecycleViewLike;
	view.openedAt = nowMs();
	view.startupRefocusDone = false;
	view.container = view.contentEl.createDiv("epoch-container");
	const root = view.container.createDiv("epoch-root");
	view.rootEl = root;
	view.controlsEl = root.createDiv("epoch-controls");
	view.reviewFilterMode = view.plugin?.viewPreferences?.showDraftsOnly === true ? "draft" : "reviewed+draft";
	view.showAttachments = !!view.plugin?.viewPreferences?.showAttachments;
	view.showTrackedChanges = view.plugin?.viewPreferences?.showTrackedChanges !== false;
	view.showContentDates = view.plugin?.viewPreferences?.showParsed !== false;
	view.showPropDates = view.showContentDates && view?.plugin?.settings?.parseDatesInFrontmatter === true;
	view.showEpochsView = view.plugin?.viewPreferences?.showEpochsView === true && view.isEpochsEnabled();
	// Session-only: do not persist timeline search query.
	view.searchQuery = "";

	view.filtersExpanded = false;
	view.buttonSettings = createFilterToggle({
		container: view.controlsEl,
		filtersExpanded: view.filtersExpanded,
		registerDomEvent: (el, event, callback, options) => void view.registerDomEvent(el, event, callback, options),
		onToggle: () => void view.setFiltersExpanded(!view.filtersExpanded)
	});
	view.filtersPanelEl = view.controlsEl.createDiv("epoch-control-panel epoch-filter-buttons");
	updateFilterPanelState({
		expanded: view.filtersExpanded,
		controlsEl: view.controlsEl,
		settingsButton: view.buttonSettings,
		filtersPanel: view.filtersPanelEl
	});

	view.buttonReview = createFilterButton({
		container: view.filtersPanelEl,
		registerDomEvent: (el, event, callback, options) => void view.registerDomEvent(el, event, callback, options),
		isPro: () => view.isPro(),
		notifyProFeature: (message) => void view.plugin?.notifyProFeature?.(message),
		config: {
			label: "Review",
			tooltip: "Reviewed & Drafts",
			icon: "scan-eye",
			getValue: () => {
				return String(view.reviewFilterMode || "reviewed+draft") !== "reviewed+draft";
			},
			onToggle: () => {
				view.cycleReviewFilterMode?.();
			}
		}
	});

	view.buttonEdits = createFilterButton({
		container: view.filtersPanelEl,
		registerDomEvent: (el, event, callback, options) => void view.registerDomEvent(el, event, callback, options),
		isPro: () => view.isPro(),
		notifyProFeature: (message) => void view.plugin?.notifyProFeature?.(message),
		config: {
			label: "Edits",
			tooltip: "Show tracked",
			icon: "history",
			requiresPro: true,
			proMessage: "Filtering tracked changes",
			getValue: () => {
				return !!view.showTrackedChanges;
			},
			onToggle: () => {
				view.setShowTrackedChanges?.(!view.showTrackedChanges);
			}
		}
	});

	view.buttonParsed = createFilterButton({
		container: view.filtersPanelEl,
		registerDomEvent: (el, event, callback, options) => void view.registerDomEvent(el, event, callback, options),
		isPro: () => view.isPro(),
		notifyProFeature: (message) => void view.plugin?.notifyProFeature?.(message),
		config: {
			label: "Parsed",
			tooltip: "Show parsed",
			icon: "file-text",
			getValue: () => {
				return !!view.showContentDates;
			},
			onToggle: () => {
				view.setShowContentDates?.(!view.showContentDates);
			}
		}
	});

	view.buttonAttachments = createFilterButton({
		container: view.filtersPanelEl,
		registerDomEvent: (el, event, callback, options) => void view.registerDomEvent(el, event, callback, options),
		isPro: () => view.isPro(),
		notifyProFeature: (message) => void view.plugin?.notifyProFeature?.(message),
		config: {
			label: "Attachments",
			tooltip: "Show attachments",
			icon: "paperclip",
			getValue: () => {
				return !!view.showAttachments;
			},
			onToggle: () => {
				view.setShowAttachments?.(!view.showAttachments);
			}
		}
	});

	view.buttonEpochs = createFilterButton({
		container: view.filtersPanelEl,
		registerDomEvent: (el, event, callback, options) => void view.registerDomEvent(el, event, callback, options),
		isPro: () => view.isPro(),
		notifyProFeature: (message) => void view.plugin?.notifyProFeature?.(message),
		config: {
			label: "Epochs",
			tooltip: "Show Epochs",
			icon: "hourglass",
			requiresPro: true,
			proMessage: "Epochs",
				getValue: () => view.showEpochsView,
				onToggle: () => void view.setShowEpochsView(!view.showEpochsView)
		}
	});
	view.updateFilterButtons();
		view.canvas = new EpochCanvas(root, view.plugin, view.leaf);
	try {
		view.canvas.onAfterDraw = () => {
			view.scheduleSearchControlRefresh();
		};
	} catch {
		// ignore
	}
	if (!view.canvas) return;
	view.canvas.setReviewFilterMode(view.reviewFilterMode);
	view.canvas.setShowTrackedChanges(view.showTrackedChanges);
	view.canvas.setShowContentDates(view.showContentDates);
	view.canvas.setShowPropDates(view.showPropDates);
	view.canvas.setShowAttachments(view.showAttachments);
	view.canvas.setEpochsView(view.showEpochsView);
	view.canvas.setSearchQuery(view.searchQuery);

	// Bottom-center search control.
	view.searchControlEl = root.createDiv("epoch-search-control");
	view.searchControlEl.setAttribute("aria-label", "Search timeline");
	view.searchControlEl.setAttribute("role", "button");
	view.searchControlEl.tabIndex = 0;
	view.searchControlIconEl = view.searchControlEl.createSpan("epoch-search-control-icon");
	setIcon(view.searchControlIconEl, view.showEpochsView ? "hourglass" : "search");
	view.searchControlTextEl = view.searchControlEl.createSpan("epoch-search-control-text");
	view.registerDomEvent(view.searchControlEl, "click", () => void view.openSearchModal());
	view.registerDomEvent(view.searchControlEl, "keydown", (e: Event) => {
		if (!(e instanceof KeyboardEvent)) return;
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			view.openSearchModal();
		}
	});
	view.updateSearchControl();
	view.scheduleSearchControlLayout();
	try {
		if (typeof ResizeObserver !== "undefined") {
			view.searchControlResizeObserver = new ResizeObserver(() => {
				view.scheduleSearchControlLayout();
				view.scheduleSearchControlRefresh();
			});
			view.searchControlResizeObserver.observe(root);
		}
	} catch {
		// ignore
	}
	view.refreshSyncedEpochAvailability();
	const resolveFileFromLeafState = (leaf: WorkspaceLeaf | null | undefined): TFile | null => {
		try {
			const vs = leaf?.getViewState?.();
			const raw = vs?.state?.file ?? vs?.state?.path ?? null;
			const path = typeof raw === "string" ? raw : "";
			if (!path) return null;
			const af = view.app.vault.getAbstractFileByPath(path);
			return af instanceof TFile ? af : null;
		} catch {
			return null;
		}
	};
	// Delay initial active-file sync until after startup snap + first size/layout.
	view.registerEvent(
		view.app.workspace.on("active-leaf-change", () => {
			let leafFilePath: string | null = null;
			let shouldForceFocus = false;
			try {
				const leaf = view.app.workspace.activeLeaf;
				const leafView = leaf?.view;
				if (leafView instanceof MarkdownView) {
					const f = leafView.file;
					if (f instanceof TFile) leafFilePath = f.path;
				} else {
					const f = resolveFileFromLeafState(leaf);
					if (f instanceof TFile) {
						leafFilePath = f.path;
						shouldForceFocus = true;
					}
				}
			} catch {
				// ignore
			}
			const suppressFocus = shouldForceFocus ? false : (!!leafFilePath && leafFilePath === view.activeFilePath);
			view.updateActiveFile(undefined, { suppressFocus });
		})
	);
	// Some close-tab flows don't reliably fire file-open with null; layout-change is a
	// cheap backstop to keep highlights in sync.
	view.registerEvent(
		view.app.workspace.on("layout-change", () => {
			const now = nowMs();
			const allowStartupFocus = view.openedAt > 0 && now - view.openedAt < 15_000 && !view.startupRefocusDone;
			view.updateActiveFile(undefined, { suppressFocus: allowStartupFocus ? false : true });
		})
	);
	view.registerEvent(
		view.app.workspace.on("file-open", (...args: unknown[]) => {
			const file = args[0];
			view.syncCanvasActiveFile(file instanceof TFile ? file : null);
		})
	);
	view.registerEvent(
		view.app.vault.on("rename", (...args: unknown[]) => {
			const file = args[0];
			const oldPath = typeof args[1] === "string" ? args[1] : "";
			if (!(file instanceof TFile)) return;
			if (!view.activeFilePath) return;
			if (view.activeFilePath !== oldPath && view.activeFilePath !== file.path) return;
			view.syncCanvasActiveFile(file, { suppressFocus: true });
		})
	);
	view.updateProUiState();

	const refreshStyles = () => {
		view.canvas?.refreshStyles();
	};
	view.registerEvent(view.app.workspace.on("css-change", refreshStyles));

	window.requestAnimationFrame(() => {
		const canvas = view.canvas;
		if (!canvas) return;
		let snapFile: TFile | null = null;
		let cursorLine: number | null = null;
		try {
			const leaf = view.app.workspace.activeLeaf;
			const leafView = leaf?.view;
			if (leafView instanceof MarkdownView) {
				const f = leafView.file;
				if (f instanceof TFile) {
					snapFile = f;
					const line = leafView.editor?.getCursor?.().line;
					if (typeof line === "number") cursorLine = line;
				}
			}
			if (!snapFile) {
				snapFile = resolveFileFromLeafState(leaf);
			}
		} catch {
			// ignore
		}
		if (!snapFile) {
			try {
				const leaves = view.app.workspace.getLeavesOfType?.("markdown") ?? [];
				for (const l of leaves) {
					const v = l?.view;
					if (!(v instanceof MarkdownView)) continue;
					const f = v.file;
					if (f instanceof TFile) {
						snapFile = f;
						break;
					}
					try {
						const vs = l?.getViewState?.();
						const raw = vs?.state?.file ?? vs?.state?.path ?? null;
						const path = typeof raw === "string" ? raw : "";
						if (!path) continue;
						const af = view.app.vault.getAbstractFileByPath(path);
						if (af instanceof TFile) {
							snapFile = af;
							break;
						}
					} catch {
						// ignore
					}
				}
			} catch {
				// ignore
			}
		}

		view.startupSnapPath = snapFile?.path ?? null;
		// Priority: opened file -> today.
		// Initialize canvas size first so startup snap uses the same geometry as
		// later manual/ribbon snaps.
		const hasOpenFile = !!view.startupSnapPath;
		canvas.initSize();
		if (hasOpenFile) {
			if (Platform.isMobile && cursorLine == null) {
				view.startupDeferredSnapPath = view.startupSnapPath;
				view.startupDeferredSnapUntil = nowMs() + 12_000;
			} else {
				canvas.snapInitialPosition(view.startupSnapPath, cursorLine, { draw: false });
			}
		} else {
			canvas.snapInitialPosition(null, null, { draw: false });
		}
		view.updateActiveFile();
		// Reconcile one frame later: some startup layouts settle after the first
		// snap, which can produce a slight offset compared to manual ribbon open.
		window.requestAnimationFrame(() => {
			try {
				if (!view.canvas) return;
				if (Platform.isMobile && view.startupDeferredSnapPath) return;
				if (view.startupSnapPath) {
					view.canvas.snapInitialPosition(view.startupSnapPath, cursorLine, { draw: false });
				} else {
					view.canvas.snapInitialPosition(null, null, { draw: false });
				}
			} catch {
				// ignore
			}
		});
		if (!Platform.isMobile) {
			view.startStartupDefaultNoteRefocus();
		}
	});
}

export async function epochViewOnClose(view: unknown): Promise<void> {
	const state = view as LifecycleViewLike;
	state.clearStartupRefocusTimer();
	state.startupSnapPath = null;
	state.startupDeferredSnapPath = null;
	state.startupDeferredSnapUntil = 0;
	try {
		if (state.searchControlLayoutRaf != null) {
			window.cancelAnimationFrame(state.searchControlLayoutRaf);
		}
	} catch {
		// ignore
	}
	state.searchControlLayoutRaf = null;
	try {
		if (state.searchControlRefreshRaf != null) {
			window.cancelAnimationFrame(state.searchControlRefreshRaf);
		}
	} catch {
		// ignore
	}
	state.searchControlRefreshRaf = null;
	try {
		state.searchControlResizeObserver?.disconnect?.();
	} catch {
		// ignore
	}
	state.searchControlResizeObserver = null;
	try {
		if (state.searchPersistTimer != null) {
			window.clearTimeout(state.searchPersistTimer);
		}
	} catch {
		// ignore
	}
	state.searchPersistTimer = null;
	try {
		if (state.canvas) state.canvas.onAfterDraw = null;
	} catch {
		// ignore
	}
	state.rootEl = null;
	state.container?.empty();
	state.canvas?.destroy();
}
