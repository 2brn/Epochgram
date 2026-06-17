import { MarkdownView, Platform, setIcon, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";

import { EpochCanvas } from "../epoch-canvas";
import {
	createFilterButton,
	createFilterToggle,
	updateFilterPanelState
} from "../epoch-view/filter-ui";

export async function epochViewOnOpen(view: any): Promise<void> {
	view.openedAt = performance.now();
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
		registerDomEvent: (el, event, callback, options) => view.registerDomEvent(el, event as any, callback as any, options),
		onToggle: () => view.setFiltersExpanded(!view.filtersExpanded)
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
		registerDomEvent: (el, event, callback, options) => view.registerDomEvent(el, event as any, callback as any, options),
		isPro: () => view.isPro(),
		notifyProFeature: (message) => view.plugin?.notifyProFeature?.(message),
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
		registerDomEvent: (el, event, callback, options) => view.registerDomEvent(el, event as any, callback as any, options),
		isPro: () => view.isPro(),
		notifyProFeature: (message) => view.plugin?.notifyProFeature?.(message),
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
		registerDomEvent: (el, event, callback, options) => view.registerDomEvent(el, event as any, callback as any, options),
		isPro: () => view.isPro(),
		notifyProFeature: (message) => view.plugin?.notifyProFeature?.(message),
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
		registerDomEvent: (el, event, callback, options) => view.registerDomEvent(el, event as any, callback as any, options),
		isPro: () => view.isPro(),
		notifyProFeature: (message) => view.plugin?.notifyProFeature?.(message),
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
		registerDomEvent: (el, event, callback, options) => view.registerDomEvent(el, event as any, callback as any, options),
		isPro: () => view.isPro(),
		notifyProFeature: (message) => view.plugin?.notifyProFeature?.(message),
		config: {
			label: "Epochs",
			tooltip: "Show Epochs",
			icon: "hourglass",
			requiresPro: true,
			proMessage: "Epochs",
			getValue: () => view.showEpochsView,
			onToggle: () => view.setShowEpochsView(!view.showEpochsView)
		}
	});
	view.updateFilterButtons();
	view.canvas = new EpochCanvas(root, view.plugin, view.leaf);
	try {
		(view.canvas as any).onAfterDraw = () => {
			view.scheduleSearchControlRefresh();
		};
	} catch {
		// ignore
	}
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
	view.registerDomEvent(view.searchControlEl, "click", () => view.openSearchModal());
	view.registerDomEvent(view.searchControlEl, "keydown", (e: KeyboardEvent) => {
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
			const getViewState = (leaf as any)?.getViewState;
			if (typeof getViewState !== "function") return null;
			const vs = getViewState.call(leaf);
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
				const leaf = (view.app.workspace as any)?.activeLeaf as WorkspaceLeaf | null | undefined;
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
			const now = performance.now();
			const allowStartupFocus = view.openedAt > 0 && now - view.openedAt < 15_000 && !view.startupRefocusDone;
			view.updateActiveFile(undefined, { suppressFocus: allowStartupFocus ? false : true });
		})
	);
	view.registerEvent(
		view.app.workspace.on("file-open", (file: TFile | null) => {
			view.syncCanvasActiveFile(file instanceof TFile ? file : null);
		})
	);
	view.registerEvent(
		view.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
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
		let snapFile: TFile | null = null;
		let cursorLine: number | null = null;
		try {
			const leaf = (view.app.workspace as any)?.activeLeaf as WorkspaceLeaf | null | undefined;
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
				const leaves: any[] = (view.app.workspace as any)?.getLeavesOfType?.("markdown") ?? [];
				for (const l of leaves) {
					const v = l?.view;
					if (!(v instanceof MarkdownView)) continue;
					const f = v.file;
					if (f instanceof TFile) {
						snapFile = f;
						break;
					}
					try {
						const getViewState = l?.getViewState;
						if (typeof getViewState !== "function") continue;
						const vs = getViewState.call(l);
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
		view.canvas.initSize();
		if (hasOpenFile) {
			if (Platform.isMobileApp && cursorLine == null) {
				view.startupDeferredSnapPath = view.startupSnapPath;
				view.startupDeferredSnapUntil = performance.now() + 12_000;
			} else {
				view.canvas.snapInitialPosition(view.startupSnapPath, cursorLine, { draw: false });
			}
		} else {
			view.canvas.snapInitialPosition(null, null, { draw: false });
		}
		view.updateActiveFile();
		// Reconcile one frame later: some startup layouts settle after the first
		// snap, which can produce a slight offset compared to manual ribbon open.
		window.requestAnimationFrame(() => {
			try {
				if (!view.canvas) return;
				if (Platform.isMobileApp && view.startupDeferredSnapPath) return;
				if (view.startupSnapPath) {
					view.canvas.snapInitialPosition(view.startupSnapPath, cursorLine, { draw: false });
				} else {
					view.canvas.snapInitialPosition(null, null, { draw: false });
				}
			} catch {
				// ignore
			}
		});
		if (!Platform.isMobileApp) {
			view.startStartupDefaultNoteRefocus();
		}
	});
}

export async function epochViewOnClose(view: any): Promise<void> {
	view.clearStartupRefocusTimer();
	view.startupSnapPath = null;
	view.startupDeferredSnapPath = null;
	view.startupDeferredSnapUntil = 0;
	try {
		if (view.searchControlLayoutRaf != null) {
			window.cancelAnimationFrame(view.searchControlLayoutRaf);
		}
	} catch {
		// ignore
	}
	view.searchControlLayoutRaf = null;
	try {
		if (view.searchControlRefreshRaf != null) {
			window.cancelAnimationFrame(view.searchControlRefreshRaf);
		}
	} catch {
		// ignore
	}
	view.searchControlRefreshRaf = null;
	try {
		view.searchControlResizeObserver?.disconnect?.();
	} catch {
		// ignore
	}
	view.searchControlResizeObserver = null;
	try {
		if (view.searchPersistTimer != null) {
			window.clearTimeout(view.searchPersistTimer);
		}
	} catch {
		// ignore
	}
	view.searchPersistTimer = null;
	try {
		if (view.canvas) (view.canvas as any).onAfterDraw = null;
	} catch {
		// ignore
	}
	view.rootEl = null;
	view.container?.empty();
	view.canvas?.destroy();
}
