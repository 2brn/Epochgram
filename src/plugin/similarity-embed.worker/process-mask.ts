import {
	maskNodeDetectionForBrowserLibraries,
	restoreNodeDetectionMask
} from "../worker-env";

declare const self: unknown;

export async function withProcessMasked<T>(fn: () => Promise<T>): Promise<T> {
	const g = self as Record<string, unknown>;
	const snapshot = maskNodeDetectionForBrowserLibraries(g);
	try {
		return await fn();
	} finally {
		restoreNodeDetectionMask(g, snapshot);
	}
}
