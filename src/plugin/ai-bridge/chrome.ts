function openExternal(url: string): void {
	try {
		const electron = (globalThis as any).require?.("electron");
		if (electron?.shell?.openExternal) {
			void electron.shell.openExternal(url);
			return;
		}
	} catch {}
	try {
		window.open(url);
	} catch {}
}

export function openAiBridgeInChrome(url: string): void {
	openExternal(url);
}
