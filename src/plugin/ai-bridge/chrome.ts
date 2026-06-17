function openExternal(url: string): void {
	try {
		const electron = (window as any).require?.("electron");
		if (electron?.shell?.openExternal) {
			void electron.shell.openExternal(url);
			return;
		}
	} catch { void 0; }
	try {
		window.open(url);
	} catch { void 0; }
}

export function openAiBridgeInChrome(url: string): void {
	openExternal(url);
}
