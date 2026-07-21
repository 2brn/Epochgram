import { Notice, Setting, type App } from "obsidian";
import type { EpochPlugin } from "../main";
import { promptMaintenanceChoices } from "../ui/modals";
import type { MaintenanceChoice } from "../ui/modals";
import { runSimilarityStartupMaintenance } from "../plugin/similarity/startup-maintenance";
import { computeRebuildGating, runRebuild, runReset } from "../plugin/maintenance";

type MaintenancePluginState = {
	__epochMaintenanceInFlight?: boolean;
	rebuildTimelineSearchIndex?: () => Promise<void>;
};

export function renderMaintenanceSettings(containerEl: HTMLElement, app: App, plugin: EpochPlugin, refresh: () => void): void {
	const state = plugin as EpochPlugin & MaintenancePluginState;
	new Setting(containerEl)
		.setName("Index")
		.setDesc("Rebuild recomputes selected stores. Reset clears selected data.")
		.addButton((btn) =>
			btn
				.setButtonText("Rebuild")
				.onClick(async () => {
						try {
							if (state.__epochMaintenanceInFlight) return;
							state.__epochMaintenanceInFlight = true;
						} catch {
							// ignore
						}
						try {
							const gate = computeRebuildGating(plugin);
							const choices: MaintenanceChoice[] = [
								{ key: "__all", label: "All", checked: false },
								{ key: "index", label: "Index", checked: false },
								{ key: "searchIndex", label: "Search", checked: false },
								{
									key: "semantics",
									label: "Semantics",
									checked: false,
									disabled: !gate.semanticsEnabled,
									disabledReason: gate.semanticsEnabled
										? ""
											: "Requires Pro + Semantic threshold"
								},
								{
									key: "topics",
									label: "Topics",
									checked: false,
									disabled: !gate.topicsEnabled,
									disabledReason: gate.topicsEnabled
										? ""
											: "Requires Pro + Topics threshold"
								},
								{
									key: "aiSummaries",
									label: "AI summaries",
									checked: false,
									disabled: !gate.aiEnabled,
									disabledReason: gate.aiEnabled ? "" : "Requires Pro + Desktop"
								},
								{
									key: "epochs",
										label: "Epochs",
									checked: false,
									disabled: !gate.epochsEnabled,
									disabledReason: gate.epochsEnabled ? "" : "Requires Pro + Desktop + Generate Epochs"
								}
							];
							const picked = await promptMaintenanceChoices(app, {
								title: "Rebuild",
								confirmText: "Rebuild",
								choices
							});
							if (!picked) return;
							await runRebuild(plugin, {
								index: picked.index === true,
								semantics: picked.semantics === true,
								topics: picked.topics === true,
								aiSummaries: picked.aiSummaries === true,
								epochs: picked.epochs === true
							});
							if (picked.searchIndex === true) {
								try {
									await state.rebuildTimelineSearchIndex?.();
								} catch {
									// ignore
								}
							}
						} catch (error) {
							void error;
							new Notice("Epochgram rebuild failed (see console)", 0);
						} finally {
							try {
								state.__epochMaintenanceInFlight = false;
							} catch {
								// ignore
							}
							try {
								refresh();
							} catch {
								// ignore
							}
						}
				})
		)
		.addButton((btn) =>
			btn
				.setButtonText("Reset")
				.setWarning()
				.onClick(async () => {
						try {
							if (state.__epochMaintenanceInFlight) return;
							state.__epochMaintenanceInFlight = true;
						} catch {
							// ignore
						}
						try {
							const choices: MaintenanceChoice[] = [
								{ key: "__all", label: "All", checked: false },
								{ key: "settings", label: "Settings", checked: false },
								{
									key: "dataFiles",
									label: "Data files",
									checked: false,
									toggleWith: [
										"reviewState",
										"marks",
										"pinned",
										"semantics",
										"topics",
										"trackedChanges",
										"aiSummaries",
										"epochs"
									]
								},
								{ key: "search", label: "Search", checked: false },
								{ key: "marks", label: "Marks", checked: false, parentKey: "dataFiles" },
								{ key: "reviewState", label: "Reviews", checked: false, parentKey: "dataFiles" },
								{ key: "pinned", label: "Pinned", checked: false, parentKey: "dataFiles" },
								{ key: "semantics", label: "Semantics", checked: false, parentKey: "dataFiles" },
								{ key: "topics", label: "Topics", checked: false, parentKey: "dataFiles" },
								{ key: "trackedChanges", label: "Tracked changes", checked: false, parentKey: "dataFiles" },
								{ key: "aiSummaries", label: "AI summaries", checked: false, parentKey: "dataFiles" },
									{ key: "epochs", label: "Epochs", checked: false, parentKey: "dataFiles" }
							];
							const picked = await promptMaintenanceChoices(app, {
								title: "Reset",
								confirmText: "Reset",
								confirmWarning: true,
								choices
							});
							if (!picked) return;
							await runReset(
								plugin,
								{
									settings: picked.settings === true,
									search: picked.search === true,
									dataFiles: picked.dataFiles === true,
									marks: picked.marks === true,
									reviewState: picked.reviewState === true,
									pinned: picked.pinned === true,
									semantics: picked.semantics === true,
									topics: picked.topics === true,
									trackedChanges: picked.trackedChanges === true,
									aiSummaries: picked.aiSummaries === true,
									epochs: picked.epochs === true
								},
								{ keepLicense: true }
							);
							void runSimilarityStartupMaintenance(plugin).catch(() => undefined);
						} catch (error) {
							void error;
							new Notice("Epochgram reset failed (see console)", 5000);
						} finally {
							try {
								state.__epochMaintenanceInFlight = false;
							} catch {
								// ignore
							}
							try {
								refresh();
							} catch {
								// ignore
							}
						}
				})
		);
}
