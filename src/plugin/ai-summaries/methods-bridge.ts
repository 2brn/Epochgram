import { Notice, Platform } from "obsidian";
import type { EpochPlugin } from "../../main";
import type { AiBridgeServer } from "../ai-bridge";
import { ensureAiBridgeServerRunning } from "./bridge-server";
import { hasAiBridgeAccess, isGenerateEpochsEffective, isOpenAiBridgeOnStartupEffective, isSummarizeAIEffective } from "../pro-feature-state";

type AiBridgeStatusLike = {
	clientConnected?: boolean;
	queued?: number;
	inProgress?: number;
};

type AiBridgeWindowGlobals = Window & {
	__epochAiBridgeLastOpenAt?: number;
	__epochAiBridgeLastCloseAt?: number;
	__epochAiBridgeOpenLockUntil?: number;
	__epochAiBridgeServer?: unknown;
};

type AiBridgeRuntime = {
	aiBridge?: AiBridgeServer | null;
	aiBridgeStartPromise?: Promise<void> | null;
	aiBridgeLastOpenAt?: number;
	aiBridgeHadWebViewerLeaf?: boolean;
	epochRegenAfterAiTimer?: unknown;
	epochRegenAfterAiMode?: unknown;
	aiBridgePersistTimer?: number | null;
	refreshAiBridgeStatusBar?: () => void;
	settings: EpochPlugin["settings"];
	app: EpochPlugin["app"];
};

type BridgeLeafStateLike = {
	url?: unknown;
	path?: unknown;
	file?: unknown;
};

type BridgeLeafLike = {
	getViewState?: () => { state?: BridgeLeafStateLike } | null;
	view?: {
		getViewState?: () => { state?: BridgeLeafStateLike } | null;
		getState?: () => BridgeLeafStateLike | null;
	};
};

type BridgeWorkspaceLike = {
	getLeavesOfType?: (type: string) => BridgeLeafLike[];
	revealLeaf?: (leaf: BridgeLeafLike) => void;
	setActiveLeaf?: (leaf: BridgeLeafLike, params?: { focus?: boolean }) => void;
};

type InternalPluginLike = {
	enabled?: boolean;
	instance?: {
		options?: Record<string, unknown>;
		data?: Record<string, unknown>;
		getData?: () => unknown;
	};
};

type InternalPluginsLike = {
	getPluginById?: (id: string) => InternalPluginLike | null;
	plugins?: Record<string, InternalPluginLike>;
};

type VaultConfigLike = {
	getConfig?: (key: string) => unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object") return null;
	return value as Record<string, unknown>;
}

function readBoolFromRecords(records: Array<Record<string, unknown> | null>, keys: string[]): boolean | null {
	for (const rec of records) {
		if (!rec) continue;
		for (const key of keys) {
			if (!Object.prototype.hasOwnProperty.call(rec, key)) continue;
			const raw = rec[key];
			if (typeof raw === "boolean") return raw;
		}
	}
	return null;
}

function getWebViewerRequirements(plugin: EpochPlugin): { enabled: boolean; openExternalLinks: boolean } {
	try {
		const internal = (plugin.app as unknown as { internalPlugins?: InternalPluginsLike }).internalPlugins;
		const webviewer = typeof internal?.getPluginById === "function"
			? internal.getPluginById("webviewer")
			: (internal?.plugins?.["webviewer"] ?? null);
		const enabled = webviewer?.enabled === true;
		const instanceData = (() => {
			try {
				return webviewer?.instance?.getData?.();
			} catch {
				return null;
			}
		})();
		const vaultWebViewerCfg = (() => {
			try {
				const vault = plugin.app.vault as unknown as VaultConfigLike;
				return vault?.getConfig?.("webviewer");
			} catch {
				return null;
			}
		})();
		const records = [
			asRecord(webviewer?.instance?.options),
			asRecord(webviewer?.instance?.data),
			asRecord(instanceData),
			asRecord(vaultWebViewerCfg)
		];
		const openExternalLinks = readBoolFromRecords(records, [
			"openExternalLinks",
			"openExternalURLs",
			"openLinksExternally",
			"openExternal"
		]);
		return {
			enabled,
			openExternalLinks: openExternalLinks === true
		};
	} catch {
		return { enabled: false, openExternalLinks: false };
	}
}

function prefersObsidianWebViewer(plugin: EpochPlugin): boolean {
	if (plugin.settings.openAiBridgeInObsidianWebViewer !== true) return false;
	const req = getWebViewerRequirements(plugin);
	return req.enabled && req.openExternalLinks;
}

async function syncWebViewerPreferenceIfInvalid(plugin: EpochPlugin): Promise<void> {
	if (plugin.settings.openAiBridgeInObsidianWebViewer !== true) return;
	const req = getWebViewerRequirements(plugin);
	if (req.enabled && req.openExternalLinks) return;
	plugin.settings.openAiBridgeInObsidianWebViewer = false;
	try {
		await plugin.onSettingsChanged("openAiBridgeInObsidianWebViewer");
	} catch {
		// ignore
	}
}

function delay(ms: number): Promise<void> {
	return new Promise(resolve => window.setTimeout(resolve, ms));
}

function readLeafUrl(leaf: BridgeLeafLike): string | null {
	const fromViewState = (() => {
		try {
			const state = leaf.getViewState?.()?.state;
			return typeof state?.url === "string" ? state.url : null;
		} catch {
			return null;
		}
	})();
	if (fromViewState) return fromViewState;

	const fromViewGetViewState = (() => {
		try {
			const state = leaf.view?.getViewState?.()?.state;
			return typeof state?.url === "string" ? state.url : null;
		} catch {
			return null;
		}
	})();
	if (fromViewGetViewState) return fromViewGetViewState;

	const fromViewGetState = (() => {
		try {
			const state = leaf.view?.getState?.();
			return typeof state?.url === "string" ? state.url : null;
		} catch {
			return null;
		}
	})();
	if (fromViewGetState) return fromViewGetState;

	return null;
}

function findBridgeLeaf(plugin: EpochPlugin, bridge: AiBridgeServer): BridgeLeafLike | null {
	let expectedOrigin = "";
	let expectedPath = "/";
	let expectedToken = "";
	try {
		const u = new URL(bridge.getUrl());
		expectedOrigin = u.origin;
		expectedPath = u.pathname || "/";
		expectedToken = String(u.searchParams.get("token") || "");
	} catch {
		return null;
	}
	if (!expectedOrigin || !expectedToken) return null;

	const ws = plugin.app.workspace as unknown as BridgeWorkspaceLike;
	if (!ws || typeof ws.getLeavesOfType !== "function") return null;
	const leaves = [
		...(ws.getLeavesOfType("webviewer") ?? []),
		...(ws.getLeavesOfType("browser") ?? [])
	];

	for (const leaf of leaves) {
		const rawUrl = readLeafUrl(leaf);
		if (!rawUrl) continue;
		try {
			const u = new URL(rawUrl);
			if (u.origin !== expectedOrigin) continue;
			if ((u.pathname || "/") !== expectedPath) continue;
			if (String(u.searchParams.get("token") || "") !== expectedToken) continue;
			return leaf;
		} catch {
			continue;
		}
	}

	return null;
}

function hasBridgeLeafOpen(plugin: EpochPlugin, bridge: AiBridgeServer): boolean {
	return !!findBridgeLeaf(plugin, bridge);
}

function activateBridgeLeafIfOpen(plugin: EpochPlugin, bridge: AiBridgeServer): boolean {
	const ws = plugin.app.workspace as unknown as BridgeWorkspaceLike;
	if (!ws) return false;
	const leaf = findBridgeLeaf(plugin, bridge);
	if (!leaf) return false;
	try {
		ws.revealLeaf?.(leaf);
	} catch {
		// ignore
	}
	try {
		ws.setActiveLeaf?.(leaf, { focus: true });
	} catch {
		// ignore
	}
	return true;
}

export function syncAiBridgeConnectionFromWebViewerLeaves(this: EpochPlugin): void {
	if (!Platform.isDesktop || Platform.isMobile) return;
	if (!prefersObsidianWebViewer(this)) return;

	const runtime = this as unknown as AiBridgeRuntime;
	const bridge = runtime.aiBridge ?? null;
	if (!bridge) {
		runtime.aiBridgeHadWebViewerLeaf = false;
		return;
	}

	const hasLeaf = hasBridgeLeafOpen(this, bridge);
	const hadLeaf = runtime.aiBridgeHadWebViewerLeaf === true;
	runtime.aiBridgeHadWebViewerLeaf = hasLeaf;

	if (hadLeaf && !hasLeaf) {
		try {
			bridge.markClientDisconnected();
		} catch {
			// ignore
		}
	}
}

function getGlobalAiBridgeLastOpenAt(): number {
	try {
		const g = window as AiBridgeWindowGlobals;
		const v = g.__epochAiBridgeLastOpenAt;
		return typeof v === "number" && Number.isFinite(v) ? v : 0;
	} catch {
		return 0;
	}
}

function setGlobalAiBridgeLastOpenAt(value: number): void {
	try {
		const g = window as AiBridgeWindowGlobals;
		g.__epochAiBridgeLastOpenAt = value;
	} catch {
		// ignore
	}
}

function getGlobalAiBridgeLastCloseAt(): number {
	try {
		const g = window as AiBridgeWindowGlobals;
		const v = g.__epochAiBridgeLastCloseAt;
		return typeof v === "number" && Number.isFinite(v) ? v : 0;
	} catch {
		return 0;
	}
}

function tryAcquireGlobalAiBridgeOpenLock(lockMs: number): boolean {
	try {
		const g = window as AiBridgeWindowGlobals;
		const now = Date.now();
		const until = g.__epochAiBridgeOpenLockUntil;
		if (typeof until === "number" && Number.isFinite(until) && until > now) return false;
		g.__epochAiBridgeOpenLockUntil = now + Math.max(0, lockMs | 0);
		return true;
	} catch {
		return true;
	}
}

export async function maybePromptEnableSummarizeAIOnProActivation(this: EpochPlugin): Promise<void> {
	// No-op by design: Summarize AI is enabled only via the settings checkbox.
	return;
}

export async function enableSummarizeAIFlow(this: EpochPlugin): Promise<void> {
	// No-op by design: do not show "Generate missing AI summaries" prompts.
	// Users can trigger generation via commands or other explicit actions.
	return;
}

export async function openAiBridgeWindow(
	this: EpochPlugin,
	options: { silent?: boolean; source?: "command" | "maintenance" | "auto" | "other"; forceOpen?: boolean } = {}
): Promise<void> {
	const runtime = this as unknown as AiBridgeRuntime;
	if (!hasAiBridgeAccess(this)) {
		return;
	}
	if (!Platform.isDesktop || Platform.isMobile) {
		return;
	}
	await syncWebViewerPreferenceIfInvalid(this);

	// Hard guarantee: when Open AI bridge on startup is OFF, never auto-open Chrome.
	// Only explicit user actions (command / status bar click) can open the bridge page.
	let allowAutoOpen = false;
	let closeOnDisconnect = false;
	const preferWebViewer = prefersObsidianWebViewer(this);
	allowAutoOpen = isOpenAiBridgeOnStartupEffective(this);
	closeOnDisconnect = allowAutoOpen;
	const isUserInitiated = options.source === "command";
	const tryActivateExistingBridgeLeaf = (bridge: AiBridgeServer | null | undefined): boolean => {
		if (!preferWebViewer || !isUserInitiated || !bridge) return false;
		return activateBridgeLeafIfOpen(this, bridge);
	};
	if (!allowAutoOpen && !isUserInitiated) {
		return;
	}

	const shouldShowAlreadyOpenNotice = !options.silent && options.source === "command";
	const OPEN_LOCK_MS = 12_000;
	const tryAcquireOpenLockOrReturn = (): boolean => {
		try {
			if (!tryAcquireGlobalAiBridgeOpenLock(OPEN_LOCK_MS)) {
				if (!options.silent) new Notice("AI bridge is starting…");
				return false;
			}
			return true;
		} catch {
			return true;
		}
	};

	const starting: Promise<void> | null = runtime.aiBridgeStartPromise ?? null;
	if (starting) {
		await starting;
		const bridge2: AiBridgeServer | null = runtime.aiBridge ?? null;
		if (bridge2) {
			if (tryActivateExistingBridgeLeaf(bridge2)) {
				if (shouldShowAlreadyOpenNotice) new Notice("AI bridge is already open.");
				return;
			}
			const status2 = bridge2.getStatus() as AiBridgeStatusLike;
			if (status2.clientConnected) {
				if (shouldShowAlreadyOpenNotice) new Notice("AI bridge is already open.");
				return;
			}
			const lastOpenAt2: number = Math.max(runtime.aiBridgeLastOpenAt ?? 0, getGlobalAiBridgeLastOpenAt());
			const lastCloseAt2 = getGlobalAiBridgeLastCloseAt();
			// On some platforms/browsers (notably Chrome tab timer throttling), an already-open bridge tab
			// can appear "disconnected" after inactivity. Avoid opening duplicate tabs for silent/background
			// invocations unless the page explicitly signaled it closed.
			if (options.silent && lastCloseAt2 <= lastOpenAt2 && (Date.now() - lastOpenAt2) < 15 * 60_000) {
				return;
			}
			try {
				if (!tryAcquireOpenLockOrReturn()) return;
				await bridge2.openInChrome({ closeOnDisconnect, preferWebViewer });
				const now = Date.now();
				runtime.aiBridgeLastOpenAt = now;
				setGlobalAiBridgeLastOpenAt(now);
			} catch { void 0; }
		}
		return;
	}

	const existing: AiBridgeServer | null = runtime.aiBridge ?? null;
	if (existing) {
		if (tryActivateExistingBridgeLeaf(existing)) {
			if (shouldShowAlreadyOpenNotice) new Notice("AI bridge is already open.");
			return;
		}
		const status = existing.getStatus() as AiBridgeStatusLike;
		if (status.clientConnected) {
			if (shouldShowAlreadyOpenNotice) new Notice("AI bridge is already open.");
			return;
		}
		const lastOpenAtRaw: number = Math.max(runtime.aiBridgeLastOpenAt ?? 0, getGlobalAiBridgeLastOpenAt());
		const hasWork = ((status?.queued ?? 0) > 0) || ((status?.inProgress ?? 0) > 0);
		const lastCloseAt = getGlobalAiBridgeLastCloseAt();
		const lastOpenAt = lastCloseAt > lastOpenAtRaw ? 0 : lastOpenAtRaw;
		const throttleMs = options.silent ? 15 * 60_000 : (hasWork ? 1500 : 15_000);
		const allowImmediateUserReopen = !options.silent && (Date.now() - lastCloseAt) < 30_000;
		if (!options.forceOpen && !allowImmediateUserReopen && (Date.now() - lastOpenAt) < throttleMs) {
			if (!options.silent) new Notice("AI bridge is starting…");
			return;
		}
		try {
			if (!tryAcquireOpenLockOrReturn()) return;
			await existing.openInChrome({ closeOnDisconnect, preferWebViewer });
			const now = Date.now();
			runtime.aiBridgeLastOpenAt = now;
			setGlobalAiBridgeLastOpenAt(now);
		} catch { void 0; }
		return;
	}

	try {
		await ensureAiBridgeServerRunning(this);
		const bridge: AiBridgeServer | null = runtime.aiBridge ?? null;
		if (!bridge) return;
		if (tryActivateExistingBridgeLeaf(bridge)) {
			if (shouldShowAlreadyOpenNotice) new Notice("AI bridge is already open.");
			return;
		}
		if (!tryAcquireOpenLockOrReturn()) return;
		await bridge.openInChrome({ closeOnDisconnect, preferWebViewer });
		const now = Date.now();
		runtime.aiBridgeLastOpenAt = now;
		setGlobalAiBridgeLastOpenAt(now);
	} catch { void 0; }
}

export async function maybeOpenAiBridgeOnStartup(this: EpochPlugin): Promise<void> {
	const runtime = this as unknown as AiBridgeRuntime;
	let shouldAutoOpenPage = false;
	let aiEnabled = false;
	let wantsWebViewer = false;
	try {
		if (!hasAiBridgeAccess(this)) return;
		if (!Platform.isDesktop || Platform.isMobile) return;
		shouldAutoOpenPage = isOpenAiBridgeOnStartupEffective(this);
		wantsWebViewer = this.settings.openAiBridgeInObsidianWebViewer === true;
		aiEnabled = isSummarizeAIEffective(this) || isGenerateEpochsEffective(this);
		if (!aiEnabled) return;
	} catch {
		return;
	}

	try {
		await ensureAiBridgeServerRunning(this);
		const bridge: AiBridgeServer | null = runtime.aiBridge ?? null;
		if (!bridge) return;
		try {
			runtime.refreshAiBridgeStatusBar?.();
		} catch {
			// ignore
		}

		const status0 = bridge.getStatus() as AiBridgeStatusLike;
		if (status0.clientConnected) return;
		// If summarizeAI or generateEpochs is enabled, keep the server running so a
		// bridge page can reconnect. Only auto-open a new Chrome tab when explicitly
		// enabled by settings.
		if (!shouldAutoOpenPage) {
			try {
				runtime.refreshAiBridgeStatusBar?.();
			} catch {
				// ignore
			}
			return;
		}

		if (wantsWebViewer) {
			const activateOrRetry = async (): Promise<boolean> => {
				if (activateBridgeLeafIfOpen(this, bridge)) return true;
				const timeoutAt = Date.now() + 2000;
				while (Date.now() < timeoutAt) {
					await delay(120);
					if (activateBridgeLeafIfOpen(this, bridge)) return true;
				}
				return false;
			};

			const activated = await activateOrRetry();
			runtime.aiBridgeHadWebViewerLeaf = activated;
			if (activated) {
				try {
					runtime.refreshAiBridgeStatusBar?.();
				} catch {
					// ignore
				}
				return;
			}
		}

		await this.openAiBridgeWindow({ silent: true, source: "auto", forceOpen: true });
		try {
			runtime.refreshAiBridgeStatusBar?.();
		} catch {
			// ignore
		}
	} catch {
		// ignore
	}
}

export async function ensureAiSummarizerReadyWithProgress(this: EpochPlugin): Promise<void> {
	const runtime = this as unknown as AiBridgeRuntime;
	// Lazy-open: only prompt/open Chrome when there is active work to process.
	await ensureAiBridgeServerRunning(this);
	const bridge = runtime.aiBridge;
	if (!bridge) throw new Error("AI bridge is unavailable.");
	const status0 = bridge.getStatus() as AiBridgeStatusLike;
	const hasWork = ((status0?.queued ?? 0) > 0) || ((status0?.inProgress ?? 0) > 0);
	if (hasWork && !status0.clientConnected) {
		await this.openAiBridgeWindow({ silent: true });
	}
	const timeoutAt = Date.now() + 120_000;
	while (Date.now() < timeoutAt) {
		const s = bridge.getStatus() as AiBridgeStatusLike;
		if (s.clientConnected) return;
		await delay(500);
	}
	throw new Error("Timed out waiting for AI bridge connection. Open the bridge page and try again.");
}

export async function stopAiBridge(this: EpochPlugin): Promise<void> {
	const runtime = this as unknown as AiBridgeRuntime;
	const bridge: AiBridgeServer | null = runtime.aiBridge ?? null;
	const isGlobalBridge = (() => {
		try {
			const g = window as AiBridgeWindowGlobals;
			return g.__epochAiBridgeServer === bridge;
		} catch {
			return false;
		}
	})();

	// Keep __epochAiBridgeLastOpenAt as-is; it throttles duplicate opens during hot reload.
	runtime.aiBridge = null;
	runtime.aiBridgeStartPromise = null;
	runtime.aiBridgeLastOpenAt = 0;
	if (runtime.epochRegenAfterAiTimer != null) {
		(window.clearInterval as unknown as (id: unknown) => void)(runtime.epochRegenAfterAiTimer);
		runtime.epochRegenAfterAiTimer = null;
		runtime.epochRegenAfterAiMode = null;
	}
	if (typeof runtime.aiBridgePersistTimer === "number") {
		window.clearTimeout(runtime.aiBridgePersistTimer);
		runtime.aiBridgePersistTimer = null;
	}
	if (bridge) {
		if (isGlobalBridge) {
			try {
				const stubPlugin = {
					settings: runtime.settings,
					app: runtime.app,
					saveSettings: async () => {}
				} as unknown as EpochPlugin;
				bridge.rebind(stubPlugin, () => {});
			} catch {
				// ignore
			}
			return;
		}
		await bridge.stop();
	}
}

export function onAiBridgeOptionsChanged(this: EpochPlugin, _prev: Record<string, unknown>, _next: Record<string, unknown>): void {
	try {
		void this.reloadIndexFromPluginData?.();
	} catch { void 0; }
	return;
}
