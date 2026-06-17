import {
	maskNodeDetectionForBrowserLibraries,
	restoreNodeDetectionMask
} from "../worker-env";

export async function withProcessMasked<T>(fn: () => Promise<T>): Promise<T> {
	const g: any = self as any;
	const snapshot = maskNodeDetectionForBrowserLibraries(g);
	try {
		return await fn();
	} finally {
		restoreNodeDetectionMask(g, snapshot);
	}
}
