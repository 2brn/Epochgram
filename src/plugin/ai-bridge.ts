export type {
	AiSummaryJob
} from "./ai-bridge/types";

export type { AiBridgeServer } from "./ai-bridge/server";

import { Platform } from "obsidian";

function canLoadNodeBuiltinsForAiBridge(): boolean {
	// Treat mobile emulation as mobile: Obsidian may set both isDesktop and isMobile.
	if (!Platform.isDesktop) return false;
	const platformWithMobile = Platform as typeof Platform & { isMobile?: boolean };
	if (platformWithMobile.isMobile === true) return false;
	return true;
}

export async function loadAiBridgeServer(): Promise<typeof import("./ai-bridge/server")> {
	// Avoid loading Node built-ins (http/crypto/fs/child_process/path) unless we're
	// actually on desktop. Obsidian blocks these on mobile and in mobile emulation.
	if (!canLoadNodeBuiltinsForAiBridge()) throw new Error("AI bridge is not available in this environment");
	return await import("./ai-bridge/server");
}
