import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFolder } from "obsidian";
import { makeReviewPlugin } from "./helpers/review-plugin";
import { DEFAULT_SETTINGS } from "../src/settings-model";
vi.mock("../src/settings", async () => ({ ...(await vi.importActual("../src/settings-model")), EpochSettingTab: class {} }));
vi.mock("../src/ui/epoch-view", () => ({ EpochView: class { toggleDraftsOnly = vi.fn(); } }));
vi.mock("../src/plugin/whats-new", () => ({ maybeOpenWhatsNewOnStartup: vi.fn() }));
import { EpochView } from "../src/ui/epoch-view";
import { lifecycleMethods } from "../src/plugin/lifecycle";
import { registerFileMenu } from "../src/plugin/view/file-menu";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
function menuItems() {
	const items: any[] = [];
	return { items, addSeparator() {}, addItem(fn: any) {
		const item: any = { setTitle(title: string) { this.title = title; return this; }, setIcon() { return this; }, setDisabled() { return this; }, onClick(click: any) { this.click = click; return this; } };
		fn(item); items.push(item);
	} };
}
describe("review commands and explorer menus", () => {
	it("offers file/folder actions with folder-boundary selection and preserved Hidden records", async () => {
		const p = await makeReviewPlugin({ "folder/a.md": "Body", "folder/sub/b.md": "Body", "folderish/c.md": "Body" });
		let handler!: (menu: any, file: any) => void;
		p.registerEvent = vi.fn(); p.app.workspace.on = (_event: string, fn: any) => { handler = fn; };
		p.setPathsReview = vi.fn(async () => {}); registerFileMenu(p);
		const folder = menuItems(); handler(folder, new TFolder("folder"));
		expect(folder.items.map(item => item.title)).toEqual(["Epochgram: Review", "Epochgram: Draft", "Epochgram: Hide"]);
		await folder.items[0].click(); expect(p.setPathsReview).toHaveBeenLastCalledWith(["folder/a.md", "folder/sub/b.md"], "reviewed", true);
		p.indexer.setFileReviewState("folder/a.md", "hidden");
		const file = menuItems(); handler(file, p.files[0]);
		expect(file.items[2].title).toBe("Epochgram: Unhide"); await file.items[2].click();
		expect(p.setPathsReview).toHaveBeenLastCalledWith(["folder/a.md"], "draft");
		for (const rootPath of ["", "/"]) {
			const root = menuItems(); handler(root, new TFolder(rootPath));
			await root.items[0].click();
			expect(p.setPathsReview).toHaveBeenLastCalledWith(["folder/a.md", "folder/sub/b.md", "folderish/c.md"], "reviewed", true);
		}
	});
	it("registers and dispatches free review, visibility, bulk, and Drafts-only commands", async () => {
		const p = await makeReviewPlugin(), commands: any[] = [];
		Object.assign(p, {
			manifest: { id: "epochgram", name: "Epochgram" }, loadData: async () => ({ settings: DEFAULT_SETTINGS }), computeDataSignature: () => "settings",
			initializeIndex: async () => true, addCommand: (command: any) => commands.push(command), openEpochView: vi.fn(async () => {})
		});
		for (const name of ["registerCustomIcons", "registerFileEvents", "addSettingTab", "registerEvent", "addRibbonIcon", "registerView", "registerHoverLinkSource", "registerFileMenu", "registerInterval", "maybeRunCalendarSyncOnStartup"]) p[name] = vi.fn();
		p.app.workspace.on = vi.fn(); p.app.workspace.onLayoutReady = vi.fn(); p.app.workspace.getActiveFile = () => p.files[0];
		await lifecycleMethods.onload.call(p); await p.ensureIndexLoaded(); await p.indexer.processFile(p.files[0], { reason: "create" });
		p.setPathsReview = vi.fn(async () => {}); p.reviewAllDraftFiles = vi.fn(async () => {});
		const command = (id: string) => commands.find(c => c.id === id);
		expect(command("toggle-review-current-file").checkCallback(true)).toBe(true);
		command("toggle-review-current-file").checkCallback(false);
		for (let i = 0; i < 6; i++) await Promise.resolve();
		expect(p.setPathsReview).toHaveBeenLastCalledWith(["note.md"], "reviewed", true);
		p.indexer.setFileReviewState("note.md", "hidden"); command("toggle-visibility-current-file").checkCallback(false);
		for (let i = 0; i < 6; i++) await Promise.resolve();
		expect(p.setPathsReview).toHaveBeenLastCalledWith(["note.md"], "draft", false);
		await command("review-all").callback(); expect(p.reviewAllDraftFiles).toHaveBeenCalledOnce();
		const view: any = new (EpochView as any)(); p.app.workspace.getLeavesOfType = () => [{ view }];
		await command("toggle-drafts-only").callback(); expect(view.toggleDraftsOnly).toHaveBeenCalledOnce();
	});
});
