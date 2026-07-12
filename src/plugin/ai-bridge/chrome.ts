type RuntimeWindowLike = Window & {
	require?: (id: string) => unknown;
};

type LeafLike = {
	setViewState?: (state: unknown, eState?: unknown) => Promise<void> | void;
};

type WorkspaceLike = {
	getLeaf?: (newLeaf?: unknown) => LeafLike | null;
	revealLeaf?: (leaf: LeafLike) => void;
	setActiveLeaf?: (leaf: LeafLike, params?: { focus?: boolean }) => void;
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

async function openInObsidianWebViewer(url: string, app?: unknown): Promise<boolean> {
	const ws = (app as { workspace?: WorkspaceLike } | undefined)?.workspace;
	if (!ws || typeof ws.getLeaf !== "function") return false;
	const leaf = ws.getLeaf("tab") || ws.getLeaf(false);
	if (!leaf || typeof leaf.setViewState !== "function") return false;
	const viewStates = [
		{ type: "webviewer", state: { url }, active: true },
		{ type: "browser", state: { url }, active: true }
	];
	for (const state of viewStates) {
		try {
			await Promise.resolve(leaf.setViewState?.(state));
			try {
				ws.revealLeaf?.(leaf);
			} catch {
				// ignore
			}
			try {
				ws.setActiveLeaf?.(leaf, { focus: true });
			} catch {
				// ignore
			}
			return true;
		} catch {
			// try next view type
		}
	}
	try {
		runtimeGlobal.open?.(url, "_blank", "noopener,noreferrer");
		return true;
	} catch {
		return false;
	}
}

export async function openAiBridgeInChrome(
	url: string,
	options?: { preferWebViewer?: boolean; app?: unknown }
): Promise<void> {
	if (options?.preferWebViewer === true) {
		const opened = await openInObsidianWebViewer(url, options.app);
		if (opened) return;
	}
	openExternal(url);
}
