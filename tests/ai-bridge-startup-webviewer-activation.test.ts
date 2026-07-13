import { beforeEach, describe, expect, it, vi } from "vitest";

import { maybeOpenAiBridgeOnStartup, openAiBridgeWindow } from "../src/plugin/ai-summaries/methods-bridge";
import { withTrustedPro } from "./helpers/trusted-pro";

describe("AI bridge startup in Obsidian WebViewer", () => {
	beforeEach(() => {
		const w = window as Window & {
			__epochAiBridgeOpenLockUntil?: number;
			__epochAiBridgeLastOpenAt?: number;
			__epochAiBridgeLastCloseAt?: number;
		};
		delete w.__epochAiBridgeOpenLockUntil;
		delete w.__epochAiBridgeLastOpenAt;
		delete w.__epochAiBridgeLastCloseAt;
	});

	it("activates existing bridge leaf on startup when startup+webviewer are enabled", async () => {
		const bridgeUrl = "http://127.0.0.1:27123/?token=test-token";
		const leaf = {
			getViewState: () => ({ state: { url: bridgeUrl } })
		};
		const workspace = {
			getLeavesOfType: vi.fn((type: string) => (type === "webviewer" ? [leaf] : [])),
			revealLeaf: vi.fn(),
			setActiveLeaf: vi.fn()
		};
		const bridge = {
			getStatus: vi.fn(() => ({ clientConnected: false, queued: 0, inProgress: 0 })),
			getUrl: vi.fn(() => bridgeUrl),
			openInChrome: vi.fn(async () => {})
		};

		const plugin: any = {
			settings: {
				openAiBridgeOnStartup: true,
				openAiBridgeInObsidianWebViewer: true,
				summarizeAI: true,
				generateEpochs: false
			},
			app: {
				workspace,
				internalPlugins: {
					getPluginById: vi.fn(() => ({
						enabled: true,
						instance: { options: { openExternalLinks: true } }
					}))
				},
				vault: {}
			},
			aiBridge: bridge,
			aiBridgeStartPromise: null,
			refreshAiBridgeStatusBar: vi.fn(),
			onSettingsChanged: vi.fn(async () => {}),
			openAiBridgeWindow
		};
		withTrustedPro(plugin, "0.4.3-test", { features: ["aiBridge", "summarizeAI"] });

		await maybeOpenAiBridgeOnStartup.call(plugin);

		expect(workspace.revealLeaf).toHaveBeenCalledWith(leaf);
		expect(workspace.setActiveLeaf).toHaveBeenCalledWith(leaf, { focus: true });
		expect(bridge.openInChrome).not.toHaveBeenCalled();
	});

	it("activates existing bridge leaf even if webviewer requirements probe is not ready", async () => {
		const bridgeUrl = "http://127.0.0.1:27123/?token=test-token-probe";
		const leaf = {
			getViewState: () => ({ state: { url: bridgeUrl } })
		};
		const workspace = {
			getLeavesOfType: vi.fn((type: string) => (type === "webviewer" ? [leaf] : [])),
			revealLeaf: vi.fn(),
			setActiveLeaf: vi.fn()
		};
		const bridge = {
			getStatus: vi.fn(() => ({ clientConnected: false, queued: 0, inProgress: 0 })),
			getUrl: vi.fn(() => bridgeUrl),
			openInChrome: vi.fn(async () => {})
		};

		const plugin: any = {
			settings: {
				openAiBridgeOnStartup: true,
				openAiBridgeInObsidianWebViewer: true,
				summarizeAI: true,
				generateEpochs: false
			},
			app: {
				workspace,
				internalPlugins: {
					getPluginById: vi.fn(() => ({
						enabled: true,
						instance: { options: { openExternalLinks: false } }
					}))
				},
				vault: {}
			},
			aiBridge: bridge,
			aiBridgeStartPromise: null,
			refreshAiBridgeStatusBar: vi.fn(),
			onSettingsChanged: vi.fn(async () => {}),
			openAiBridgeWindow
		};
		withTrustedPro(plugin, "0.4.3-test", { features: ["aiBridge", "summarizeAI"] });

		await maybeOpenAiBridgeOnStartup.call(plugin);

		expect(workspace.revealLeaf).toHaveBeenCalledWith(leaf);
		expect(workspace.setActiveLeaf).toHaveBeenCalledWith(leaf, { focus: true });
		expect(bridge.openInChrome).not.toHaveBeenCalled();
	});

	it("opens bridge immediately when no bridge leaf exists", async () => {
		const bridgeUrl = "http://127.0.0.1:27123/?token=test-token-2";
		const workspace = {
			getLeavesOfType: vi.fn(() => []),
			revealLeaf: vi.fn(),
			setActiveLeaf: vi.fn()
		};
		const bridge = {
			getStatus: vi.fn(() => ({ clientConnected: false, queued: 0, inProgress: 0 })),
			getUrl: vi.fn(() => bridgeUrl),
			openInChrome: vi.fn(async () => {})
		};

		const plugin: any = {
			settings: {
				openAiBridgeOnStartup: true,
				openAiBridgeInObsidianWebViewer: true,
				summarizeAI: true,
				generateEpochs: false
			},
			app: {
				workspace,
				internalPlugins: {
					getPluginById: vi.fn(() => ({
						enabled: true,
						instance: { options: { openExternalLinks: true } }
					}))
				},
				vault: {}
			},
			aiBridge: bridge,
			aiBridgeStartPromise: null,
			refreshAiBridgeStatusBar: vi.fn(),
			onSettingsChanged: vi.fn(async () => {}),
			openAiBridgeWindow
		};
		withTrustedPro(plugin, "0.4.3-test", { features: ["aiBridge", "summarizeAI"] });

		await maybeOpenAiBridgeOnStartup.call(plugin);

		expect(bridge.openInChrome).toHaveBeenCalledTimes(1);
		expect(bridge.openInChrome).toHaveBeenCalledWith({ closeOnDisconnect: true, preferWebViewer: true });
	});
});
