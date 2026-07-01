import { MarkdownView, Platform, TFile } from "obsidian";

type StartupLeafLike = {
	view?: unknown;
	getViewState?: () => { state?: { file?: unknown; path?: unknown } };
};

type StartupCanvasLike = {
	setActiveFile(path: string, line: number | null, options?: { suppressFocus?: boolean }): void;
	hasVisibleEntryForFile?(path: string, line: number | null): boolean;
	suppressNextFocusHover?: string;
};

type StartupPluginLike = {
	noteLeaf?: StartupLeafLike | null;
	maybeIndexOpenedFile?: (file: TFile) => void;
	indexer?: { isFileKnown?(path: string): boolean };
};

type StartupViewLike = {
	startupRefocusTimer: number | null;
	startupRefocusDone: boolean;
	startupSnapPath: string | null;
	canvas: StartupCanvasLike | null;
	plugin: StartupPluginLike;
	app: {
		vault: { getAbstractFileByPath(path: string): unknown };
		workspace: {
			getLeavesOfType(type: string): StartupLeafLike[];
			getActiveFile(): unknown;
		};
	};
	shouldSuppressExternalAutoScroll(): boolean;
};

function nowMs(): number {
	return window.performance?.now?.() ?? Date.now();
}

export function clearStartupRefocusTimer(view: unknown): void {
	const state = view as StartupViewLike;
	try {
		if (state.startupRefocusTimer != null) {
			window.clearTimeout(state.startupRefocusTimer);
		}
	} catch {
		// ignore
	}
	state.startupRefocusTimer = null;
}

export function startStartupDefaultNoteRefocus(view: unknown): void {
	const state = view as StartupViewLike;
	clearStartupRefocusTimer(state);
	const startedAt = nowMs();
	let lastTriedAt = 0;
	let lastTriedPath = "";
	let attempts = 0;
	const initialPath = state.startupSnapPath;

	const resolveFileFromLeafState = (leaf: StartupLeafLike | null | undefined): TFile | null => {
		try {
			const getViewState = leaf?.getViewState;
			if (typeof getViewState !== "function") return null;
			const vs = getViewState();
			const raw = vs?.state?.file ?? vs?.state?.path ?? null;
			const path = typeof raw === "string" ? raw : "";
			if (!path) return null;
			const af = state.app.vault.getAbstractFileByPath(path);
			return af instanceof TFile ? af : null;
		} catch {
			return null;
		}
	};

	const tick = () => {
		try {
			if (state.startupRefocusDone) return;
			if (!state.canvas) return;
			// If the user interacts with the timeline (click/pan/zoom/scroll-nav), stop startup refocus
			// permanently so it can't snap the view back to the opened file.
			if (state.shouldSuppressExternalAutoScroll()) {
				state.startupRefocusDone = true;
				clearStartupRefocusTimer(state);
				return;
			}

			const now = nowMs();
			// Give startup-only behavior a bounded window.
			if (now - startedAt > 15_000 || attempts > 80) {
				state.startupRefocusDone = true;
				return;
			}
			attempts += 1;

			let f: TFile | null = null;
			let line: number | null = null;
			let sourceView: MarkdownView | null = null;

			// Prefer the remembered markdown leaf (it often becomes the default-note leaf).
			try {
				const noteLeaf = state.plugin.noteLeaf ?? null;
				const noteView = noteLeaf?.view ?? null;
				if (noteView instanceof MarkdownView) {
					const file0 = noteView.file;
					if (file0 instanceof TFile) {
						f = file0;
						sourceView = noteView;
					} else {
						const fromState = resolveFileFromLeafState(noteLeaf);
						if (fromState) {
							f = fromState;
							sourceView = noteView;
						}
					}
				}
			} catch {
				// ignore
			}

			if (!f) {
				try {
					const leaves = state.app.workspace.getLeavesOfType("markdown") ?? [];
					const candidates: Array<{ file: TFile; view: MarkdownView | null }> = [];
					for (const l of leaves) {
						const v = l?.view;
						const markdownView = v instanceof MarkdownView ? v : null;
						const file0 = (v as { file?: unknown } | null | undefined)?.file;
						if (file0 instanceof TFile) {
							candidates.push({ file: file0, view: markdownView });
							continue;
						}
						const fromState = resolveFileFromLeafState(l);
						if (fromState) {
							candidates.push({ file: fromState, view: markdownView });
						}
					}

					// If something else opened after our initial snap, prefer it even if
					// it is not the active leaf yet (daily note plugins can do background opens).
					const nonInitial = initialPath ? candidates.filter((c) => c.file.path !== initialPath) : candidates;
					const chosen = (nonInitial.length > 0 ? nonInitial : candidates).at(-1) ?? null;
					if (chosen) {
						f = chosen.file;
						sourceView = chosen.view;
					}
				} catch {
					// ignore
				}
			}

			if (!f) {
				const af = state.app.workspace.getActiveFile();
				f = af instanceof TFile ? af : null;
			}
			if (!f) {
				state.startupRefocusTimer = window.setTimeout(tick, 250);
				return;
			}
			if ((f.extension?.toLowerCase?.() ?? "") !== "md") {
				state.startupRefocusTimer = window.setTimeout(tick, 250);
				return;
			}

			// Some startup flows (daily note/new note) can create/open a file without triggering
			// a reliable file-open event until the editor gets focus. Proactively ask Epoch's
			// indexer to process it so the timeline can focus it.
			try {
				const maybeIndex = state.plugin.maybeIndexOpenedFile;
				if (typeof maybeIndex === "function") {
					void maybeIndex(f);
				}
			} catch {
				// ignore
			}

			try {
				const l0 = sourceView?.editor?.getCursor?.().line;
				if (typeof l0 === "number") line = l0;
			} catch {
				// ignore
			}

			// Wait until the file is indexed/known before trying to focus it.
			try {
				const isKnown = state.plugin.indexer?.isFileKnown?.(f.path);
				if (isKnown === false) {
					state.startupRefocusTimer = window.setTimeout(tick, 250);
					return;
				}
			} catch {
				// ignore
			}

			if (state.canvas?.hasVisibleEntryForFile?.(f.path, line) === true) {
				state.startupRefocusDone = true;
				return;
			}

			// Avoid spamming focus while an animation is in flight.
			if (f.path === lastTriedPath && now - lastTriedAt < 900) {
				state.startupRefocusTimer = window.setTimeout(tick, 250);
				return;
			}
			// On mobile, skip focusing until we know a cursor line; otherwise we can "guess" a
			// tracked-change entry and cause an unexpected jump.
			if (Platform.isMobileApp && line == null) {
				state.startupRefocusTimer = window.setTimeout(tick, 250);
				return;
			}
			lastTriedPath = f.path;
			lastTriedAt = now;
			try {
				if (state.canvas) state.canvas.suppressNextFocusHover = f.path;
			} catch {
				// ignore
			}
			state.canvas?.setActiveFile(f.path, line, { suppressFocus: false });
			state.startupRefocusTimer = window.setTimeout(tick, 250);
		} catch {
			// ignore
			state.startupRefocusTimer = window.setTimeout(tick, 250);
		}
	};

	// Start slightly later to avoid fighting initial layout & indexing.
	state.startupRefocusTimer = window.setTimeout(tick, 600);
}
