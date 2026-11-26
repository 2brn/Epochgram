import { Notice, type App } from "obsidian";
import type { EpochPlugin } from "../main";
import { promptMaintenanceChoices } from "../ui/modals";
import { runRebuild, runReset } from "../plugin/maintenance";
import type { SettingRow } from "./setting-definitions";

export function defineMaintenanceSetting(app: App, plugin: EpochPlugin, refresh: () => void): SettingRow {
	let busy = false;
	const run = async (reset: boolean) => {
		if (busy) return;
		busy = true;
		try {
			const choices = reset ? [{ key: "settings", label: "Settings", checked: false }, { key: "dataFiles", label: "Data files", checked: false }, { key: "search", label: "Search", checked: false }, { key: "reviews", label: "Reviews", checked: false }] : [{ key: "index", label: "Index", checked: false }, { key: "search", label: "Search", checked: false }];
			const picked = await promptMaintenanceChoices(app, { title: reset ? "Reset" : "Rebuild", confirmText: reset ? "Reset" : "Rebuild", confirmWarning: reset, choices: [{ key: "__all", label: "All", checked: false }, ...choices] });
			if (!picked) return;
			if (reset) await runReset(plugin, { settings: picked.settings === true, search: picked.search === true, dataFiles: picked.dataFiles === true, reviews: picked.reviews === true });
			else await runRebuild(plugin, { index: picked.index === true, search: picked.search === true });
		} catch (error) { console.error("Epochgram maintenance failed", error); new Notice("Epochgram maintenance failed", 5000); }
		finally { busy = false; refresh(); }
	};
	return {
		name: "Index",
		desc: "Rebuild recomputes selected stores. Reset clears selected data.",
		aliases: ["Reset reviews", "Rebuild search"],
		render(setting) {
			setting.addButton(button => button.setButtonText("Rebuild").onClick(() => run(false)));
			setting.addButton((button) => {
				button.setButtonText("Reset").onClick(() => run(true));
				if (typeof button.setDestructive === "function") button.setDestructive();
				else button.buttonEl.classList.add("mod-warning"); // Obsidian 1.12
			});
		}
	};
}
