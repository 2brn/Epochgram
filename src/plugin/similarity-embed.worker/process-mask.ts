import {
	maskNodeDetectionForBrowserLibraries,
	restoreNodeDetectionMask
} from "../worker-env";

export async function withProcessMasked<T>(fn: () => Promise<T>): Promise<T> {
	const g: any = typeof self !== "undefined" ? (self as any) : (typeof global !== "undefined" ? (global as any) : {});
	const snapshot = maskNodeDetectionForBrowserLibraries(g);
	try {
		return await fn();
	} finally {
		restoreNodeDetectionMask(g, snapshot);
	}
}
