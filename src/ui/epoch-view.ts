import { ItemView, WorkspaceLeaf, MarkdownView, TFile, Platform } from "obsidian";
import { VIEW_TYPE_EPOCH } from "./epoch-view-mode";
import { EpochCanvas } from "./epoch-canvas";
import {
	updateFilterPanelState
} from "./epoch-view/filter-ui";
import type { DateEntry } from "../indexer/types";
import { computeTimelineSearchResultCountAllDates, type TimelineSearchCountCache } from "./epoch-view-search-count";
import { pickBestMatchEntryForRankedPaths } from "./epoch-view-search-best-match";
import { openSearchModal } from "./epoch-view/search-modal";
import { clearStartupRefocusTimer, startStartupDefaultNoteRefocus } from "./epoch-view/startup-refocus";
import { epochViewOnClose, epochViewOnOpen } from "./epoch-view/lifecycle";
import {
	epochViewCycleReviewFilterMode,
	epochViewSetReviewFilterMode,
	epochViewSetShowAttachments,
	epochViewSetShowContentDates,
	epochViewSetShowEpochsView,
	epochViewSetShowPropDates,
	epochViewSetShowTrackedChanges,
	epochViewSyncPreferencesFromPlugin,
	epochViewUpdateFilterButtons,
	epochViewUpdateProUiState,
	epochViewUpdateReviewFilterButtonUi
} from "./epoch-view/filters";
import {
	epochViewLayoutSearchControl,
	epochViewScheduleSearchControlLayout,
	epochViewScheduleSearchControlRefresh,
	epochViewUpdateSearchControl,
} from "./epoch-view/search-control";
import { epochViewSnapToBestTimelineSearchMatch } from "./epoch-view/search-snap";
import "../../styles.css";

type EpochViewPluginLike = {
	settings?: { generateEpochs?: boolean };
	hasProAccess?: () => boolean;
	indexer?: { index?: Record<string, DateEntry[]> };
	__epochTimelineSearchFocusToken?: number;
};

type EpochCanvasStateLike = EpochCanvas & {
	__suppressExternalAutoScrollUntil?: number;
	__forcedActiveFileCursorUntil?: number;
	__forcedActiveFileCursorPath?: string | null;
	__forcedActiveFileCursorLine?: number | null;
};

type LeafViewStateLike = {
	state?: { file?: string; path?: string };
};

function nowMs(): number {
	return Date.now();
}

export class EpochView extends ItemView {
	plugin: EpochViewPluginLike;
	container!: HTMLElement;
	canvas!: EpochCanvas;
	private rootEl: HTMLElement | null = null;
	private filtersExpanded = false;
	private buttonSettings: HTMLElement | null = null;
	private filtersPanelEl: HTMLElement | null = null;
	private buttonReview: HTMLElement | null = null;
	private buttonEdits: HTMLElement | null = null;
	private buttonAttachments: HTMLElement | null = null;
	private reviewFilterMode: "reviewed+draft" | "draft" = "reviewed+draft";
	private showAttachments = false;
	private showTrackedChanges = true;
	private showContentDates = true;
	private showPropDates = false;
	private showEpochsView = false;
	private buttonEpochs: HTMLElement | null = null;
	private controlsEl: HTMLElement | null = null;
	private activeFilePath: string | null = null;
	private hasSyncedEpochEntries = false;
	private openedAt = 0;
	private startupRefocusDone = false;
	private startupRefocusTimer: number | null = null;
	private startupSnapPath: string | null = null;
	private startupDeferredSnapPath: string | null = null;
	private startupDeferredSnapUntil = 0;
	private searchQuery = "";
	private searchControlEl: HTMLElement | null = null;
	private searchControlTextEl: HTMLElement | null = null;
	private searchControlIconEl: HTMLElement | null = null;
	private searchControlResizeObserver: ResizeObserver | null = null;
	private searchControlLayoutRaf: number | null = null;
	private searchControlRefreshRaf: number | null = null;
	private searchModalOpen = false;
	private lastConsumedTimelineSearchFocusToken = 0;
	private searchCountCache: TimelineSearchCountCache = { key: null, value: null };

	private setFiltersExpanded(expanded: boolean): void {
		const next = expanded === true;
		if (this.filtersExpanded === next) return;
		this.filtersExpanded = next;
		updateFilterPanelState({
			expanded: this.filtersExpanded,
			controlsEl: this.controlsEl,
			settingsButton: this.buttonSettings,
			filtersPanel: this.filtersPanelEl
		});
	}

	private setSearchQueryInternal(nextQuery: string): void {
		const next = String(nextQuery || "");
		if (String(this.searchQuery || "") === next) return;
		this.searchQuery = next;
		this.canvas?.setSearchQuery(this.searchQuery);
		this.updateSearchControl();
		this.updateFilterButtons();
	}

	private computeTimelineSearchResultCountAllDates(qTrim: string): number | null {
		if (!this.canvas) return null;
		return computeTimelineSearchResultCountAllDates(this.canvas, qTrim, this.searchCountCache);
	}

	private pickBestMatchEntryForRankedPaths(
		rankedPaths: string[],
		parsed: Parameters<typeof pickBestMatchEntryForRankedPaths>[2]
	): { path: string; entry: DateEntry } | null {
		if (!this.canvas) return null;
		return pickBestMatchEntryForRankedPaths(this.canvas, rankedPaths, parsed);
	}

	public snapToBestTimelineSearchMatch(options: { draw?: boolean } = {}): boolean {
		return epochViewSnapToBestTimelineSearchMatch(this, options);
	}

	private maybeFocusTimelineSearchAfterRebuild(): void {
		try {
			const tokenRaw = Number(this.plugin?.__epochTimelineSearchFocusToken ?? 0);
			const token = Number.isFinite(tokenRaw) ? Math.max(0, Math.floor(tokenRaw)) : 0;
			if (token <= 0) return;
			if (token === this.lastConsumedTimelineSearchFocusToken) return;
			// Intentionally do not auto-focus/snap after rebuild. Applying a search filter should not
			// move the timeline; only explicit record selection should scroll/focus.
			this.lastConsumedTimelineSearchFocusToken = token;
		} catch {
			// ignore
		}
	}

	private scheduleSearchControlLayout(): void {
		epochViewScheduleSearchControlLayout(this);
	}

	private scheduleSearchControlRefresh(): void {
		epochViewScheduleSearchControlRefresh(this);
	}

	private layoutSearchControl(): void {
		epochViewLayoutSearchControl(this);
	}

	private updateSearchControl(): void {
		epochViewUpdateSearchControl(this);
	}

	private openSearchModal(): void {
		return openSearchModal(this as unknown as Parameters<typeof openSearchModal>[0]);
	}

	public openTimelineSearch(): void {
		this.openSearchModal();
	}

	private shouldSuppressExternalAutoScroll(): boolean {
		try {
			if (this.searchModalOpen) return true;
			const until = Number((this.canvas as EpochCanvasStateLike | null)?.__suppressExternalAutoScrollUntil ?? 0);
			return Number.isFinite(until) && until > 0 && nowMs() < until;
		} catch {
			return false;
		}
	}

	private syncCanvasActiveFile = (file: TFile | null, options: { suppressFocus?: boolean } = {}) => {
		if (!file) {
			this.activeFilePath = null;
			this.canvas?.setActiveFile(null);
			return;
		}
		if (this.shouldSuppressExternalAutoScroll()) {
			this.activeFilePath = file.path;
			this.canvas?.setActiveFile(file.path, null, { suppressFocus: true });
			return;
		}
		let cursorLine: number | null = null;
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);

		// If scroll-nav recently navigated to a specific entry, prefer its blockStart as the
		// effective cursor line for a short window so follow-focus doesn't snap back.
		try {
			const canvasState = this.canvas as EpochCanvasStateLike;
			const forcedUntil = Number(canvasState?.__forcedActiveFileCursorUntil ?? 0);
			const forcedPath = String(canvasState?.__forcedActiveFileCursorPath ?? "");
			const forcedLineRaw = Number(canvasState?.__forcedActiveFileCursorLine ?? NaN);
			const forcedActive =
				forcedPath === file.path &&
				Number.isFinite(forcedUntil) && forcedUntil > 0 &&
				nowMs() < forcedUntil &&
				Number.isFinite(forcedLineRaw);

			const editorLine = view?.editor?.getCursor?.().line;
			const editorFocused = !!view?.editor?.hasFocus?.();
			if (forcedActive && editorFocused && typeof editorLine === "number" && Number.isFinite(editorLine) && editorLine !== forcedLineRaw) {
				// User moved the cursor intentionally; stop forcing.
				canvasState.__forcedActiveFileCursorUntil = 0;
				canvasState.__forcedActiveFileCursorPath = null;
				canvasState.__forcedActiveFileCursorLine = null;
				cursorLine = editorLine;
			} else if (forcedActive) {
				cursorLine = Math.max(0, forcedLineRaw | 0);
			} else {
				if (forcedPath && forcedPath !== file.path) {
					canvasState.__forcedActiveFileCursorUntil = 0;
					canvasState.__forcedActiveFileCursorPath = null;
					canvasState.__forcedActiveFileCursorLine = null;
				}
				if (typeof editorLine === "number") {
					cursorLine = editorLine;
				}
			}
		} catch {
			const editorLine = view?.editor?.getCursor?.().line;
			if (typeof editorLine === "number") {
				cursorLine = editorLine;
			}
		}

		// Mobile: if startup deferred an initial snap, apply it once the file is known.
		try {
			if (Platform.isMobileApp && this.startupDeferredSnapPath && this.canvas) {
				const now = nowMs();
				if (now > (this.startupDeferredSnapUntil ?? 0)) {
					this.startupDeferredSnapPath = null;
					this.startupDeferredSnapUntil = 0;
				} else if (file.path === this.startupDeferredSnapPath) {
					(this.canvas as EpochCanvasStateLike).__suppressExternalAutoScrollUntil = nowMs() + 1000;
					this.canvas.snapInitialPosition(file.path, cursorLine);
					this.canvas.setActiveFile(file.path, cursorLine, { suppressFocus: true });
					this.activeFilePath = file.path;
					this.startupDeferredSnapPath = null;
					this.startupDeferredSnapUntil = 0;
					return;
				}
			}
		} catch {
			// ignore
		}
		this.activeFilePath = file.path;
		const ext = file.extension?.toLowerCase?.() ?? "";
		if (ext === "md") {
			if (options.suppressFocus === true) {
				this.canvas?.setActiveFile(file.path, cursorLine, { suppressFocus: true });
				return;
			}
			this.canvas?.setActiveFile(file.path, cursorLine, { suppressFocus: false });
		} else {
			this.canvas?.setActiveFile(file.path, null, { suppressFocus: options.suppressFocus === true });
		}
	};

	private updateActiveFile = (_leaf?: unknown, options: { suppressFocus?: boolean } = {}) => {
		const suppressFocus = options.suppressFocus !== false;
		const resolveFileFromLeafState = (leaf: WorkspaceLeaf | null | undefined): TFile | null => {
			try {
				const getViewState = (leaf as unknown as { getViewState?: () => LeafViewStateLike }).getViewState;
				if (typeof getViewState !== "function") return null;
				const vs = getViewState.call(leaf);
				const raw = vs?.state?.file ?? vs?.state?.path ?? null;
				const path = typeof raw === "string" ? raw : "";
				if (!path) return null;
				const af = this.app.vault.getAbstractFileByPath(path);
				return af instanceof TFile ? af : null;
			} catch {
				return null;
			}
		};
		// Prefer the active leaf's file, so closing the last tab (MarkdownView.file -> null)
		// immediately clears semantic highlights. workspace.getActiveFile() can return the
		// last active file even when the current leaf has no file.
		try {
			const leaf = (this.app.workspace as unknown as { activeLeaf?: WorkspaceLeaf | null }).activeLeaf;
			const view = leaf?.view;
			if (view instanceof MarkdownView) {
				const f = view.file;
				this.syncCanvasActiveFile(f instanceof TFile ? f : null, { suppressFocus });
				return;
			}
			const nonMarkdownFile = resolveFileFromLeafState(leaf);
			if (nonMarkdownFile) {
				this.syncCanvasActiveFile(nonMarkdownFile, { suppressFocus: false });
				return;
			}
		} catch {
			// ignore
		}
		const file = this.app.workspace.getActiveFile();
		// If the active leaf is not a MarkdownView (e.g. switching focus to the Epoch timeline),
		// keep highlights in sync but do not auto-scroll the timeline to the last active file.
		// Exception: allow a short startup window so newly created default notes can still be focused.
		const now = nowMs();
		const allowStartupFocus = this.openedAt > 0 && now - this.openedAt < 15_000 && !this.startupRefocusDone;
		this.syncCanvasActiveFile(file instanceof TFile ? file : null, { suppressFocus: allowStartupFocus ? suppressFocus : true });
	};

	private clearStartupRefocusTimer(): void {
		return clearStartupRefocusTimer(this);
	}

	private startStartupDefaultNoteRefocus(): void {
		return startStartupDefaultNoteRefocus(this);
	}

	private isPro(): boolean {
		return !!this.plugin?.hasProAccess?.();
	}

	private isEpochsEnabled(): boolean {
		return this.plugin?.settings?.generateEpochs === true;
	}

	private refreshSyncedEpochAvailability(): void {
		const index = this.plugin?.indexer?.index;
		// During rebuild/refresh flows, the in-memory index can be temporarily empty or unset.
		// Do not treat that transient state as "epochs unavailable" (it can cause epochs view
		// to flip back to normal a few seconds after the user turns it on).
		if (!index || typeof index !== "object") return;
		const lists = Object.values(index);
		if (lists.length === 0) return;

		let sawAnyEntries = false;
		let found = false;
		for (const list of lists) {
			if (!Array.isArray(list) || list.length === 0) continue;
			sawAnyEntries = true;
			if (list.some((e) => e && String(e.file || "").startsWith("epoch://"))) {
				found = true;
				break;
			}
		}
		if (!sawAnyEntries) return;
		this.hasSyncedEpochEntries = found;
	}

	private updateProUiState() {
		epochViewUpdateProUiState(this);
	}

	constructor(leaf: WorkspaceLeaf, plugin: EpochViewPluginLike) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return VIEW_TYPE_EPOCH;
	}

	getDisplayText() {
		return "Epochgram";
	}

	getIcon(): string {
		return "epochgram-logo";
	}

	async onOpen() {
		return epochViewOnOpen(this);
	}

	focusToday() {
		if (!this.canvas) return;
		this.canvas.focusToday();
	}

	refreshIndex() {
		if (!this.canvas) return;
		this.canvas.refreshIndex();
		this.maybeFocusTimelineSearchAfterRebuild();
		this.refreshSyncedEpochAvailability();
		this.updateProUiState();
		this.scheduleSearchControlRefresh();
	}

	async onClose() {
		return epochViewOnClose(this);
	}

	syncPreferencesFromPlugin(preferences: { showDraftsOnly?: boolean; showAttachments: boolean; showTrackedChanges?: boolean; showParsed?: boolean; showEpochsView?: boolean }): void {
		epochViewSyncPreferencesFromPlugin(this, preferences);
	}

	private updateFilterButtons() {
		epochViewUpdateFilterButtons(this);
	}

	private updateReviewFilterButtonUi(mode: "reviewed+draft" | "draft"): void {
		epochViewUpdateReviewFilterButtonUi(this, mode);
	}

	private setShowEpochsView(value: boolean) {
		epochViewSetShowEpochsView(this, value);
	}

	private cycleReviewFilterMode(): void {
		epochViewCycleReviewFilterMode(this);
	}

	private setReviewFilterMode(mode: "reviewed+draft" | "draft") {
		epochViewSetReviewFilterMode(this, mode);
	}

	private setShowTrackedChanges(value: boolean) {
		epochViewSetShowTrackedChanges(this, value);
	}

	private setShowContentDates(value: boolean) {
		epochViewSetShowContentDates(this, value);
	}

	private setShowPropDates(value: boolean) {
		epochViewSetShowPropDates(this, value);
	}

	private setShowAttachments(value: boolean) {
		epochViewSetShowAttachments(this, value);
	}

}
