const runtimeGlobal: any = typeof window !== "undefined" ? (window as any) : (typeof global !== "undefined" ? (global as any) : {});

function openExternal(url: string): void {
	try {
		const electron = runtimeGlobal.require?.("electron");
		if (electron?.shell?.openExternal) {
			void electron.shell.openExternal(url);
			return;
		}
	} catch { void 0; }
	try {
		runtimeGlobal.open?.(url);
	} catch { void 0; }
}

export function openAiBridgeInChrome(url: string): void {
	openExternal(url);
}
