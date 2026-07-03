import { Platform } from "obsidian";
import type { EpochPlugin } from "../../main";
import type { AiBridgeServer } from "../ai-bridge";
import { loadAiBridgeServer } from "../ai-bridge";
import { handleBridgeResult } from "./result-handler";

type BridgeWindowState = Window & {
	__epochAiBridgeServer?: AiBridgeServer | null;
};

type BridgePluginState = {
	aiBridge?: AiBridgeServer | null;
	aiBridgeStartPromise?: Promise<void> | null;
	proNoticesShown?: Set<string>;
};

export async function ensureAiBridgeServerRunning(plugin: EpochPlugin): Promise<void> {
	if (!Platform.isDesktop || Platform.isMobile) {
		throw new Error("AI bridge is desktop-only");
	}
	// Hot reload / plugin reload safety: reuse a single bridge server instance across reloads.
	// This prevents creating a second server on a new port, which would force-opening a
	// duplicate Chrome bridge tab.
	try {
		const g = window as BridgeWindowState;
		const globalBridge: AiBridgeServer | null = g.__epochAiBridgeServer ?? null;
		if (globalBridge) {
			globalBridge.rebind(plugin, (job, result) => {
				try { handleBridgeResult(plugin, job, result); } catch { void 0; }
			});
			(plugin as EpochPlugin & BridgePluginState).aiBridge = globalBridge;
			return;
		}
	} catch {
		// ignore
	}

	const state = plugin as EpochPlugin & BridgePluginState;
	const existing: AiBridgeServer | null = state.aiBridge ?? null;
	if (existing) return;

	const starting: Promise<void> | null = state.aiBridgeStartPromise ?? null;
	if (starting) {
		await starting;
		return;
	}

	const startPromise = (async () => {
		const { AiBridgeServer } = await loadAiBridgeServer();
		const bridge = new AiBridgeServer(plugin, (job, result) => {
			try { handleBridgeResult(plugin, job, result); } catch { void 0; }
		});
		state.aiBridge = bridge;
		await bridge.start();
		try {
			const g = window as BridgeWindowState;
			g.__epochAiBridgeServer = bridge;
		} catch {
			// ignore
		}
	})();

	state.aiBridgeStartPromise = startPromise;
	try {
		await startPromise;
	} finally {
		state.aiBridgeStartPromise = null;
	}
}

export function maybeNudgeBridgeNotReady(plugin: EpochPlugin, bridge: AiBridgeServer): void {
	const status = bridge.getStatus();
	if (status.clientConnected) return;
	const key = "ai-bridge-not-ready";
	const state = plugin as EpochPlugin & BridgePluginState;
	const shown: Set<string> = state.proNoticesShown ?? new Set<string>();
	state.proNoticesShown = shown;
	if (shown.has(key)) return;
	shown.add(key);
}
