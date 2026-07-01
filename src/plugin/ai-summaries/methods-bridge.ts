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
	epochRegenAfterAiTimer?: unknown;
	epochRegenAfterAiMode?: unknown;
	aiBridgePersistTimer?: number | null;
	refreshAiBridgeStatusBar?: () => void;
	settings: EpochPlugin["settings"];
	app: EpochPlugin["app"];
};

function delay(ms: number): Promise<void> {
	return new Promise(resolve => window.setTimeout(resolve, ms));
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
	if (!Platform.isDesktopApp || Platform.isMobileApp) {
		return;
	}

	// Hard guarantee: when Open AI bridge on startup is OFF, never auto-open Chrome.
	// Only explicit user actions (command / status bar click) can open the bridge page.
	let allowAutoOpen = false;
	let closeOnDisconnect = false;
	allowAutoOpen = isOpenAiBridgeOnStartupEffective(this);
	closeOnDisconnect = allowAutoOpen;
	const isUserInitiated = options.source === "command";
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
			const status2 = bridge2.getStatus() as AiBridgeStatusLike;
			if (status2.clientConnected) {
				if (shouldShowAlreadyOpenNotice) new Notice("AI bridge is already open in Chrome.");
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
				await bridge2.openInChrome({ closeOnDisconnect });
				const now = Date.now();
				runtime.aiBridgeLastOpenAt = now;
				setGlobalAiBridgeLastOpenAt(now);
			} catch { void 0; }
		}
		return;
	}

	const existing: AiBridgeServer | null = runtime.aiBridge ?? null;
	if (existing) {
		const status = existing.getStatus() as AiBridgeStatusLike;
		if (status.clientConnected) {
			if (shouldShowAlreadyOpenNotice) new Notice("AI bridge is already open in Chrome.");
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
			await existing.openInChrome({ closeOnDisconnect });
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
		if (!tryAcquireOpenLockOrReturn()) return;
		await bridge.openInChrome({ closeOnDisconnect });
		const now = Date.now();
		runtime.aiBridgeLastOpenAt = now;
		setGlobalAiBridgeLastOpenAt(now);
	} catch { void 0; }
}

export async function maybeOpenAiBridgeOnStartup(this: EpochPlugin): Promise<void> {
	const runtime = this as unknown as AiBridgeRuntime;
	let shouldAutoOpenPage = false;
	let aiEnabled = false;
	try {
		if (!hasAiBridgeAccess(this)) return;
		if (!Platform.isDesktopApp || Platform.isMobileApp) return;
		shouldAutoOpenPage = isOpenAiBridgeOnStartupEffective(this);
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

		// If a bridge page is already open (e.g. during plugin hot-reload), it should reconnect
		// quickly once the server is back. Wait briefly before opening a new Chrome tab.
		const timeoutAt = Date.now() + 20_000;
		while (Date.now() < timeoutAt) {
			try {
				const s = bridge.getStatus() as AiBridgeStatusLike;
				if (s.clientConnected) return;
			} catch {
				// ignore
			}
			await delay(200);
		}

		// Auto-summarize enabled: ensure the bridge page is open so background work can run.
		// Use the regular open flow to respect global throttling/locking.
		await this.openAiBridgeWindow({ silent: true });
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
	throw new Error("Timed out waiting for Chrome bridge. Open the bridge page in Google Chrome.");
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
