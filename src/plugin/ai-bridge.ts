export type {
	AiSummaryJob
} from "./ai-bridge/types";

export type { AiBridgeServer } from "./ai-bridge/server";

import { Platform } from "obsidian";

type RuntimeWindowLike = Window & {
	require?: (id: string) => unknown;
	process?: {
		versions?: {
			node?: string;
		};
	};
};

const runtimeGlobal: RuntimeWindowLike = window;

function canLoadNodeBuiltinsForAiBridge(): boolean {
	// Treat mobile emulation as mobile: Obsidian may set both isDesktopApp and isMobileApp.
	if (!Platform.isDesktopApp) return false;
	if (Platform.isMobileApp) return false;
	const platformWithMobile = Platform as typeof Platform & { isMobile?: boolean };
	if (platformWithMobile.isMobile === true) return false;

	// Do NOT probe Node built-ins via require("http") etc:
	// in sandboxed contexts this can log noisy console errors even if caught.
	const req = runtimeGlobal?.require;
	if (typeof req !== "function") return false;

	// Basic Node presence check.
	const proc = runtimeGlobal?.process;
	if (!proc?.versions?.node) return false;
	return true;
}

export async function loadAiBridgeServer(): Promise<typeof import("./ai-bridge/server")> {
	// Avoid loading Node built-ins (http/crypto/fs/child_process/path) unless we're
	// actually on desktop. Obsidian blocks these on mobile and in mobile emulation.
	if (!canLoadNodeBuiltinsForAiBridge()) throw new Error("AI bridge is not available in this environment");
	return await import("./ai-bridge/server");
}
