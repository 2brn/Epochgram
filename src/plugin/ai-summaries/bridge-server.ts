import { Platform } from "obsidian";
import type { EpochPlugin } from "../../main";
import type { AiBridgeServer } from "../ai-bridge";
import { loadAiBridgeServer } from "../ai-bridge";
import { handleBridgeResult } from "./result-handler";

export async function ensureAiBridgeServerRunning(plugin: EpochPlugin): Promise<void> {
	if (!Platform.isDesktopApp || Platform.isMobileApp) {
		throw new Error("AI bridge is desktop-only");
	}
	// Hot reload / plugin reload safety: reuse a single bridge server instance across reloads.
	// This prevents creating a second server on a new port, which would force-opening a
	// duplicate Chrome bridge tab.
	try {
		const g: any = globalThis as any;
		const globalBridge: AiBridgeServer | null = g.__epochAiBridgeServer ?? null;
		if (globalBridge) {
			globalBridge.rebind(plugin, (job, result) => {
				try { handleBridgeResult(plugin, job, result); } catch {}
			});
			(plugin as any).aiBridge = globalBridge;
			return;
		}
	} catch {
		// ignore
	}

	const existing: AiBridgeServer | null = (plugin as any).aiBridge ?? null;
	if (existing) return;

	const starting: Promise<void> | null = (plugin as any).aiBridgeStartPromise ?? null;
	if (starting) {
		await starting;
		return;
	}

	const startPromise = (async () => {
		const { AiBridgeServer } = await loadAiBridgeServer();
		const bridge = new AiBridgeServer(plugin, (job, result) => {
			try { handleBridgeResult(plugin, job, result); } catch {}
		});
		(plugin as any).aiBridge = bridge;
		await bridge.start();
		try {
			const g: any = globalThis as any;
			g.__epochAiBridgeServer = bridge;
		} catch {
			// ignore
		}
	})();

	(plugin as any).aiBridgeStartPromise = startPromise;
	try {
		await startPromise;
	} finally {
		(plugin as any).aiBridgeStartPromise = null;
	}
}

export function maybeNudgeBridgeNotReady(plugin: EpochPlugin, bridge: AiBridgeServer): void {
	const status = bridge.getStatus();
	if ((status as any).clientConnected) return;
	const key = "ai-bridge-not-ready";
	const shown: Set<string> = (plugin as any).proNoticesShown ?? new Set<string>();
	(plugin as any).proNoticesShown = shown;
	if (shown.has(key)) return;
	shown.add(key);
}
