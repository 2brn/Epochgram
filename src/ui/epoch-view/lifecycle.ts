import { MarkdownView, Platform, setIcon, TFile, type WorkspaceLeaf, type EventRef } from "obsidian";
import type { EpochPlugin } from "../../main";
import { EpochCanvas } from "../epoch-canvas";
import { createFilterButton, createFilterToggle, updateFilterPanelState, type RegisterDomEvent } from "./filter-ui";
type View = {
	openedAt: number; startupRefocusDone: boolean; container: HTMLElement; contentEl: HTMLElement; rootEl: HTMLElement | null;
	controlsEl: HTMLElement; filtersExpanded: boolean; buttonSettings: HTMLElement; filtersPanelEl: HTMLElement;
	buttonParsed: HTMLElement; buttonAttachments: HTMLElement; buttonDrafts: HTMLElement;
	showAttachments: boolean; showContentDates: boolean; showPropDates: boolean; showDraftsOnly: boolean;
	searchQuery: string; searchControlEl: HTMLElement; searchControlIconEl: HTMLElement; searchControlTextEl: HTMLElement;
	searchControlResizeObserver: ResizeObserver | null; searchControlLayoutRaf: number | null; searchControlRefreshRaf: number | null;
	startupSnapPath: string | null; startupDeferredSnapPath: string | null; startupDeferredSnapUntil: number;
	activeFilePath: string | null; leaf: WorkspaceLeaf; plugin: EpochPlugin; app: EpochPlugin["app"]; canvas: EpochCanvas | null;
	registerDomEvent: RegisterDomEvent; registerEvent(ref: EventRef): void;
	setShowDraftsOnly(value: boolean): void;
	setFiltersExpanded(value: boolean): void; setShowContentDates(value: boolean): void; setShowAttachments(value: boolean): void;
	updateFilterButtons(): void; scheduleSearchControlRefresh(): void; scheduleSearchControlLayout(): void;
	openSearchModal(): void; updateSearchControl(): void;
	updateActiveFile(leaf?: unknown, options?: { suppressFocus?: boolean }): void;
	syncCanvasActiveFile(file: TFile | null, options?: { suppressFocus?: boolean }): void;
	startStartupDefaultNoteRefocus(): void; clearStartupRefocusTimer(): void;
};
export async function epochViewOnOpen(input: unknown): Promise<void> {
	const view = input as View;
	view.openedAt = Date.now(); view.startupRefocusDone = false;
	view.container = view.contentEl.createDiv("epoch-container");
	const root = view.container.createDiv("epoch-root");
	if (Platform.isMacOS) root.classList.add("is-macos");
	view.rootEl = root; view.controlsEl = root.createDiv("epoch-controls");
	view.showAttachments = view.plugin.viewPreferences.showAttachments;
	view.showDraftsOnly = view.plugin.viewPreferences.showDraftsOnly === true;
	view.showContentDates = view.plugin.viewPreferences.showParsed;
	view.showPropDates = view.showContentDates && view.plugin.settings.parseDatesInFrontmatter === true;
	view.searchQuery = ""; view.filtersExpanded = false;
	const registerDomEvent: RegisterDomEvent = (...args) => view.registerDomEvent(...args);
	view.buttonSettings = createFilterToggle({ container: view.controlsEl, filtersExpanded: false, registerDomEvent, onToggle: () => view.setFiltersExpanded(!view.filtersExpanded) });
	view.filtersPanelEl = view.controlsEl.createDiv("epoch-control-panel epoch-filter-buttons");
	updateFilterPanelState({ expanded: false, controlsEl: view.controlsEl, settingsButton: view.buttonSettings, filtersPanel: view.filtersPanelEl });
	view.buttonDrafts = createFilterButton({ container: view.filtersPanelEl, registerDomEvent, config: { label: "Drafts only", tooltip: "Reviewed & drafts", icon: "scan-eye", getValue: () => view.showDraftsOnly, onToggle: () => view.setShowDraftsOnly(!view.showDraftsOnly) } });
	view.buttonParsed = createFilterButton({ container: view.filtersPanelEl, registerDomEvent, config: { label: "Content dates", tooltip: "Show content dates", icon: "calendar", getValue: () => view.showContentDates, onToggle: () => view.setShowContentDates(!view.showContentDates) } });
	view.buttonAttachments = createFilterButton({ container: view.filtersPanelEl, registerDomEvent, config: { label: "Attachments", tooltip: "Show attachments", icon: "paperclip", getValue: () => view.showAttachments, onToggle: () => view.setShowAttachments(!view.showAttachments) } });
	view.updateFilterButtons();
	view.canvas = new EpochCanvas(root, view.plugin, view.leaf);
	view.canvas.onAfterDraw = () => view.scheduleSearchControlRefresh();
	view.canvas.setShowDraftsOnly(view.showDraftsOnly);
	view.canvas.setShowContentDates(view.showContentDates); view.canvas.setShowPropDates(view.showPropDates); view.canvas.setShowAttachments(view.showAttachments); view.canvas.setSearchQuery("");
	view.searchControlEl = root.createDiv("epoch-search-control");
	view.searchControlEl.setAttribute("aria-label", "Search timeline"); view.searchControlEl.setAttribute("role", "button"); view.searchControlEl.tabIndex = 0;
	view.searchControlIconEl = view.searchControlEl.createSpan("epoch-search-control-icon"); setIcon(view.searchControlIconEl, "search");
	view.searchControlTextEl = view.searchControlEl.createSpan("epoch-search-control-text");
	registerDomEvent(view.searchControlEl, "click", () => view.openSearchModal());
	registerDomEvent(view.searchControlEl, "keydown", event => { if (event instanceof KeyboardEvent && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); view.openSearchModal(); } });
	view.updateSearchControl(); view.scheduleSearchControlLayout();
	if (typeof ResizeObserver !== "undefined") {
		view.searchControlResizeObserver = new ResizeObserver(() => { view.scheduleSearchControlLayout(); view.scheduleSearchControlRefresh(); });
		view.searchControlResizeObserver.observe(root);
	}
	const fileFromLeaf = (leaf: WorkspaceLeaf | null | undefined): TFile | null => {
		if (leaf?.view instanceof MarkdownView) return leaf.view.file;
		const state = leaf?.getViewState?.()?.state;
		const path = state?.file ?? state?.path;
		const file = typeof path === "string" ? view.app.vault.getAbstractFileByPath(path) : null;
		return file instanceof TFile ? file : null;
	};
	view.registerEvent(view.app.workspace.on("active-leaf-change", leaf => {
		const file = fileFromLeaf(leaf);
		view.updateActiveFile(undefined, { suppressFocus: !!file && file.path === view.activeFilePath });
	}));
	view.registerEvent(view.app.workspace.on("layout-change", () => view.updateActiveFile(undefined, { suppressFocus: !(Date.now() - view.openedAt < 15000 && !view.startupRefocusDone) })));
	view.registerEvent(view.app.workspace.on("file-open", file => view.syncCanvasActiveFile(file)));
	view.registerEvent(view.app.vault.on("rename", (file, oldPath) => { if (file instanceof TFile && (view.activeFilePath === oldPath || view.activeFilePath === file.path)) view.syncCanvasActiveFile(file, { suppressFocus: true }); }));
	view.registerEvent(view.app.workspace.on("css-change", () => view.canvas?.refreshStyles()));
	window.requestAnimationFrame(() => {
		const canvas = view.canvas; if (!canvas) return;
		const activeLeaf = (view.app.workspace as unknown as { activeLeaf?: WorkspaceLeaf }).activeLeaf;
		const file = fileFromLeaf(activeLeaf) ?? view.app.workspace.getLeavesOfType("markdown").map(fileFromLeaf).find(Boolean) ?? null;
		const line = activeLeaf?.view instanceof MarkdownView ? activeLeaf.view.editor?.getCursor?.().line ?? null : null;
		view.startupSnapPath = file?.path ?? null;
		canvas.initSize();
		if (Platform.isMobile && file && line == null) { view.startupDeferredSnapPath = file.path; view.startupDeferredSnapUntil = Date.now() + 12000; }
		else canvas.snapInitialPosition(file?.path ?? null, line, { draw: false });
		view.updateActiveFile(); if (!Platform.isMobile) view.startStartupDefaultNoteRefocus();
	});
}
export async function epochViewOnClose(input: unknown): Promise<void> {
	const view = input as View;
	view.clearStartupRefocusTimer(); view.startupSnapPath = null; view.startupDeferredSnapPath = null; view.startupDeferredSnapUntil = 0;
	if (view.searchControlLayoutRaf != null) window.cancelAnimationFrame(view.searchControlLayoutRaf);
	if (view.searchControlRefreshRaf != null) window.cancelAnimationFrame(view.searchControlRefreshRaf);
	view.searchControlLayoutRaf = null; view.searchControlRefreshRaf = null;
	view.searchControlResizeObserver?.disconnect(); view.searchControlResizeObserver = null;
	if (view.canvas) view.canvas.onAfterDraw = null;
	view.rootEl = null; view.canvas?.destroy(); view.container?.empty();
}
