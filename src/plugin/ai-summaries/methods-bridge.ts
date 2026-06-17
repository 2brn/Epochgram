import { Notice, Platform } from "obsidian";
import type { EpochPlugin } from "../../main";
import type { AiBridgeServer } from "../ai-bridge";
import { ensureAiBridgeServerRunning } from "./bridge-server";
import { hasAiBridgeAccess, isGenerateEpochsEffective, isOpenAiBridgeOnStartupEffective, isSummarizeAIEffective } from "../pro-feature-state";

function delay(ms: number): Promise<void> {
	return new Promise(resolve => window.setTimeout(resolve, ms));
}

function getGlobalAiBridgeLastOpenAt(): number {
	try {
		const g: any = window as any;
		const v = g.__epochAiBridgeLastOpenAt;
		return typeof v === "number" && Number.isFinite(v) ? v : 0;
	} catch {
		return 0;
	}
}

function setGlobalAiBridgeLastOpenAt(value: number): void {
	try {
		const g: any = window as any;
		g.__epochAiBridgeLastOpenAt = value;
	} catch {
		// ignore
	}
}

function getGlobalAiBridgeLastCloseAt(): number {
	try {
		const g: any = window as any;
		const v = g.__epochAiBridgeLastCloseAt;
		return typeof v === "number" && Number.isFinite(v) ? v : 0;
	} catch {
		return 0;
	}
}

function tryAcquireGlobalAiBridgeOpenLock(lockMs: number): boolean {
	try {
		const g: any = window as any;
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

	const starting: Promise<void> | null = (this as any).aiBridgeStartPromise ?? null;
	if (starting) {
		await starting;
		const bridge2: AiBridgeServer | null = (this as any).aiBridge ?? null;
		if (bridge2) {
			const status2 = bridge2.getStatus();
			if ((status2 as any).clientConnected) {
				if (shouldShowAlreadyOpenNotice) new Notice("AI bridge is already open in Chrome.");
				return;
			}
			const lastOpenAt2: number = Math.max((this as any).aiBridgeLastOpenAt ?? 0, getGlobalAiBridgeLastOpenAt());
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
				(this as any).aiBridgeLastOpenAt = now;
				setGlobalAiBridgeLastOpenAt(now);
			} catch { void 0; }
		}
		return;
	}

	const existing: AiBridgeServer | null = (this as any).aiBridge ?? null;
	if (existing) {
		const status = existing.getStatus();
		if ((status as any).clientConnected) {
			if (shouldShowAlreadyOpenNotice) new Notice("AI bridge is already open in Chrome.");
			return;
		}
		const lastOpenAtRaw: number = Math.max((this as any).aiBridgeLastOpenAt ?? 0, getGlobalAiBridgeLastOpenAt());
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
			(this as any).aiBridgeLastOpenAt = now;
			setGlobalAiBridgeLastOpenAt(now);
		} catch { void 0; }
		return;
	}

	try {
		await ensureAiBridgeServerRunning(this);
		const bridge: AiBridgeServer | null = (this as any).aiBridge ?? null;
		if (!bridge) return;
		if (!tryAcquireOpenLockOrReturn()) return;
		await bridge.openInChrome({ closeOnDisconnect });
		const now = Date.now();
		(this as any).aiBridgeLastOpenAt = now;
		setGlobalAiBridgeLastOpenAt(now);
	} catch { void 0; }
}

export async function maybeOpenAiBridgeOnStartup(this: EpochPlugin): Promise<void> {
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
		const bridge: AiBridgeServer | null = (this as any).aiBridge ?? null;
		if (!bridge) return;
		try {
			void (this as any).refreshAiBridgeStatusBar?.();
		} catch {
			// ignore
		}

		const status0 = bridge.getStatus();
		if ((status0 as any)?.clientConnected) return;
		// If summarizeAI or generateEpochs is enabled, keep the server running so a
		// bridge page can reconnect. Only auto-open a new Chrome tab when explicitly
		// enabled by settings.
		if (!shouldAutoOpenPage) {
			try {
				void (this as any).refreshAiBridgeStatusBar?.();
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
				const s = bridge.getStatus();
				if ((s as any)?.clientConnected) return;
			} catch {
				// ignore
			}
			await delay(200);
		}

		// Auto-summarize enabled: ensure the bridge page is open so background work can run.
		// Use the regular open flow to respect global throttling/locking.
		await this.openAiBridgeWindow({ silent: true });
		try {
			void (this as any).refreshAiBridgeStatusBar?.();
		} catch {
			// ignore
		}
	} catch {
		// ignore
	}
}

export async function ensureAiSummarizerReadyWithProgress(this: EpochPlugin): Promise<void> {
	// Lazy-open: only prompt/open Chrome when there is active work to process.
	await ensureAiBridgeServerRunning(this);
	const bridge: AiBridgeServer = (this as any).aiBridge;
	const status0 = bridge?.getStatus?.();
	const hasWork = ((status0?.queued ?? 0) > 0) || ((status0?.inProgress ?? 0) > 0);
	if (hasWork && !(status0 as any)?.clientConnected) {
		await this.openAiBridgeWindow({ silent: true });
	}
	const timeoutAt = Date.now() + 120_000;
	while (Date.now() < timeoutAt) {
		const s = bridge.getStatus();
		if ((s as any).clientConnected) return;
		await delay(500);
	}
	throw new Error("Timed out waiting for Chrome bridge. Open the bridge page in Google Chrome.");
}

export async function stopAiBridge(this: EpochPlugin): Promise<void> {
	const bridge: AiBridgeServer | null = (this as any).aiBridge ?? null;
	const isGlobalBridge = (() => {
		try {
			const g: any = window as any;
			return g.__epochAiBridgeServer === bridge;
		} catch {
			return false;
		}
	})();

	// Keep __epochAiBridgeLastOpenAt as-is; it throttles duplicate opens during hot reload.
	(this as any).aiBridge = null;
	(this as any).aiBridgeStartPromise = null;
	(this as any).aiBridgeLastOpenAt = 0;
	if (typeof (this as any).epochRegenAfterAiTimer === "number") {
		window.clearInterval((this as any).epochRegenAfterAiTimer);
		(this as any).epochRegenAfterAiTimer = null;
		(this as any).epochRegenAfterAiMode = null;
	}
	if (typeof (this as any).aiBridgePersistTimer === "number") {
		window.clearTimeout((this as any).aiBridgePersistTimer);
		(this as any).aiBridgePersistTimer = null;
	}
	if (bridge) {
		if (isGlobalBridge) {
			try {
				const stubPlugin: any = {
					settings: (this as any).settings,
					app: (this as any).app,
					saveSettings: async () => {}
				};
				bridge.rebind(stubPlugin, () => {});
			} catch {
				// ignore
			}
			return;
		}
		await bridge.stop();
	}
}

export function onAiBridgeOptionsChanged(this: EpochPlugin, _prev: Record<string, any>, _next: Record<string, any>): void {
	try {
		void this.reloadIndexFromPluginData?.();
	} catch { void 0; }
	return;
}
