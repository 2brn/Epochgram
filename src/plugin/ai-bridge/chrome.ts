type RuntimeWindowLike = Window & {
	require?: (id: string) => unknown;
};

type ElectronLike = {
	shell?: {
		openExternal?: (url: string) => Promise<void> | void;
	};
};

const runtimeGlobal: RuntimeWindowLike = window;

function openExternal(url: string): void {
	try {
		const electron = runtimeGlobal.require?.("electron") as ElectronLike | undefined;
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
