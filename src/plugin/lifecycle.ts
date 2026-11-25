import { MarkdownView, Notice, normalizePath, type EventRef } from "obsidian";
import { EpochSettingTab } from "../settings";
import { readCurrentSettings } from "../settings-schema";
import { Indexer } from "../indexer/indexer";
import { VIEW_TYPE_EPOCH } from "../ui/epoch-view-mode";
import { EpochView } from "../ui/epoch-view";
import { VIEW_TYPE_WHATS_NEW } from "../ui/whats-new-view-mode";
import { WhatsNewView } from "../ui/whats-new-view";
import { getEpochMarkBaseColorIndexOrder, normalizeMarkColorIndex } from "../ui/mark-colors";
import type { PersistedPluginData } from "./state";
import type { EpochPlugin } from "../main";
import { initEpochStatusBarProgress } from "./progress";
import { applyMarkColorWithContext } from "./mark-context";
import { onViewUnload } from "./view/leaf-actions";
import { wrapNoticeError } from "./notice-utils";
import { maybeOpenWhatsNewOnStartup } from "./whats-new";

export const lifecycleMethods = {
	async onload(this: EpochPlugin): Promise<void> {
		const runtime = this as EpochPlugin & { __epochStartupIndexPromise?: Promise<void>; __epochUnloaded?: boolean; __timelineSearchCacheSaveTimer?: number | null };
		runtime.__epochUnloaded = false;
		this.register?.(() => {
			runtime.__epochUnloaded = true;
			if (runtime.__timelineSearchCacheSaveTimer != null) window.clearTimeout(runtime.__timelineSearchCacheSaveTimer);
			runtime.__timelineSearchCacheSaveTimer = null;
		});
		initEpochStatusBarProgress(this);
		this.registerCustomIcons();
		this.pluginDirPath = normalizePath(`${this.app.vault.configDir}/plugins/${this.manifest.id}`);
		this.indexFilePath = normalizePath(`${this.pluginDirPath}/index.json`);
		this.dataFilePath = normalizePath(`${this.pluginDirPath}/data.json`);
		const saved = await this.loadData() as PersistedPluginData | null;
		this.lastDataSignature = this.computeDataSignature(saved);
		this.settings = readCurrentSettings(saved?.settings);
		if (!saved?.settings) { this.applyDailyNotesDefaults(); await this.saveSettings(); }
		this.viewPreferences = { showAttachments: this.settings.timelineFilters?.showAttachments === true, showParsed: this.settings.timelineFilters?.showParsed !== false };
		this.indexer = new Indexer(this);
		this.refreshExcludedMatchers();
		this.indexReady = false;
		runtime.__epochStartupIndexPromise = this.indexLoadPromise = (async () => {
			try {
				if (!await this.initializeIndex()) await this.rebuildIndexWithProgress({ skipEnsure: true });
			} catch {
				try { await this.rebuildIndexWithProgress({ skipEnsure: true }); }
				catch (error) { console.error("Epochgram: Startup indexing failed", error); new Notice("Epochgram: Startup indexing failed. Use Rebuild to retry."); }
			} finally {
				this.indexReady = true;
				this.indexLoadPromise = null;
				delete runtime.__epochStartupIndexPromise;
				if (!runtime.__epochUnloaded) { this.refreshEpochViews(); void this.ensureExcludedSync(); }
			}
		})();
		this.registerFileEvents();
		this.addSettingTab(new EpochSettingTab(this.app, this));
		this.addCommand({ id: "open-view", name: "Open timeline", callback: wrapNoticeError("Epochgram: Open timeline failed", () => this.openEpochView()) });
		this.addCommand({ id: "search-timeline", name: "Search timeline", callback: wrapNoticeError("Epochgram: Search timeline failed", () => this.openTimelineSearch()) });
		const withView = async (run: (view: EpochView) => void) => {
			await this.openEpochView({ skipSnap: true });
			const view = this.app.workspace.getLeavesOfType(VIEW_TYPE_EPOCH)[0]?.view;
			if (view instanceof EpochView) run(view);
		};
		this.addCommand({ id: "toggle-drafts-only", name: "Toggle drafts only", callback: wrapNoticeError("Epochgram: Review filter failed", () => withView(view => view.toggleDraftsOnly())) });
		this.addCommand({ id: "review-all", name: "Review all", callback: wrapNoticeError("Epochgram: Review all failed", () => this.reviewAllDraftFiles()) });
		for (const visibility of [false, true]) this.addCommand({
			id: visibility ? "toggle-visibility-current-file" : "toggle-review-current-file",
			name: visibility ? "Toggle visibility for current file" : "Toggle review for current file",
			checkCallback: checking => {
				const file = this.app.workspace.getActiveFile();
				if (!file || !this.indexReady || !this.shouldIndexFile(file) || !this.indexer.isFileKnown(file.path)) return false;
				if (!checking) void wrapNoticeError("Epochgram: Review action failed", async () => {
					await this.ensureIndexLoaded();
					const current = this.indexer.getFileReviewState(file.path);
					await this.setPathsReview([file.path], visibility ? (current === "hidden" ? "draft" : "hidden") : (current === "reviewed" ? "draft" : "reviewed"), !visibility);
				})();
				return true;
			}
		});
		this.addCommand({ id: "toggle-content-dates", name: "Toggle content dates", callback: wrapNoticeError("Epochgram: Toggle content dates failed", () => withView(view => view.toggleContentDates())) });
		this.addCommand({ id: "toggle-attachments", name: "Toggle attachments", callback: wrapNoticeError("Epochgram: Toggle attachments failed", () => withView(view => view.toggleAttachments())) });
		this.addCommand({ id: "sync-calendar", name: "Sync calendar", callback: wrapNoticeError("Epochgram: Calendar sync failed", () => this.runCalendarSync({ reason: "manual", showNotice: true })) });
		this.addCommand({ id: "toggle-mark-current-note", name: "Toggle mark for current file", checkCallback: checking => {
			const file = this.app.workspace.getActiveFile();
			if (!file || !this.shouldIndexFile(file) || !this.indexer.isFileKnown(file.path)) return false;
			if (!checking) void wrapNoticeError("Epochgram: Toggle mark failed", async () => {
				await this.ensureIndexLoaded(); await this.waitForExcludedSync();
				const explicit = normalizeMarkColorIndex(this.indexer.getFileMarkColor(file.path));
				const inherited = normalizeMarkColorIndex(this.__epochInheritedMarkIndexByPath?.get(file.path));
				const current = explicit ?? inherited;
				await applyMarkColorWithContext(this, { entryPath: file.path, nextColorIndex: current != null ? null : getEpochMarkBaseColorIndexOrder()[0] ?? 1, currentColorIndex: current });
			})();
			return true;
		} });
		this.addCommand({ id: "toggle-pin-current-note", name: "Toggle pin for current file", checkCallback: checking => {
			const file = this.app.workspace.getActiveFile();
			if (!file || !this.shouldIndexFile(file) || !this.indexer.isFileKnown(file.path)) return false;
			if (!checking) void wrapNoticeError("Epochgram: Toggle pin failed", () => this.toggleFilePin(file, !this.indexer.isFilePinned(file.path)))();
			return true;
		} });
		this.registerEvent(this.app.workspace.on("file-open", file => { if (file) void wrapNoticeError("Epochgram: Open-file indexing failed", () => this.maybeIndexOpenedFile(file))(); }));
		const onConfigChanged = () => {
			if (this.refreshExcludedMatchers()) {
				void wrapNoticeError("Epochgram: Exclusions refresh failed", () => this.refreshIndexSmartWithProgress({ suppressNotices: true }))();
			}
		};
		const configWorkspace = this.app.workspace as unknown as { on(event: string, callback: () => void): EventRef };
		this.registerEvent(configWorkspace.on("config-changed", onConfigChanged));
		this.registerEvent(configWorkspace.on("obsidian:config-change", onConfigChanged));
		this.addRibbonIcon("epochgram-logo", "Epochgram", wrapNoticeError("Epochgram: Open timeline failed", () => this.openEpochView()));
		this.registerView(VIEW_TYPE_EPOCH, leaf => new EpochView(leaf, this));
		this.registerView(VIEW_TYPE_WHATS_NEW, leaf => new WhatsNewView(leaf, this));
		let startupOpenTimer: number | null = null;
		let unloaded = false;
		this.register?.(() => { unloaded = true; if (startupOpenTimer != null) window.clearTimeout(startupOpenTimer); });
		this.app.workspace.onLayoutReady(() => {
			if (this.settings.openEpochViewOnStartup) {
				const started = Date.now();
				const attemptOpen = () => {
					if (unloaded) return;
					const ready = this.app.workspace.getActiveViewOfType?.(MarkdownView)?.file || this.app.workspace.getLeavesOfType("markdown").some(leaf => leaf.view instanceof MarkdownView && leaf.view.file);
					if (!ready && Date.now() - started < 750) { startupOpenTimer = window.setTimeout(attemptOpen, 50); return; }
					startupOpenTimer = null;
					void wrapNoticeError("Epochgram: Auto-open timeline failed", () => this.openEpochView({ activate: true }))();
				};
				startupOpenTimer = window.setTimeout(attemptOpen, 250);
			}
			void maybeOpenWhatsNewOnStartup(this, !!saved?.settings);
		});
		this.registerHoverLinkSource(this.manifest.id, { display: this.manifest.name ?? "Epochgram", defaultMod: false });
		this.registerFileMenu();
		this.registerInterval(window.setInterval(() => {
			if (this.refreshExcludedMatchers()) void this.refreshIndexSmartWithProgress({ suppressNotices: true });
			void wrapNoticeError("Epochgram: Background poll failed", () => this.pollExternalIndexChanges())();
		}, 15000));
		this.refreshCalendarSyncSchedule();
		void this.maybeRunCalendarSyncOnStartup();
	},
	onunload(this: EpochPlugin): void { onViewUnload(this); }
};
