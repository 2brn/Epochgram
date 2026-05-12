import { MarkdownView, Platform, TFile } from "obsidian";

export function clearStartupRefocusTimer(view: any): void {
	try {
		if (view.startupRefocusTimer != null) {
			window.clearTimeout(view.startupRefocusTimer);
		}
	} catch {
		// ignore
	}
	view.startupRefocusTimer = null;
}

export function startStartupDefaultNoteRefocus(view: any): void {
	clearStartupRefocusTimer(view);
	const startedAt = performance.now();
	let lastTriedAt = 0;
	let lastTriedPath = "";
	let attempts = 0;
	const initialPath = view.startupSnapPath;

	const resolveFileFromLeafState = (leaf: any): TFile | null => {
		try {
			const getViewState = leaf?.getViewState;
			if (typeof getViewState !== "function") return null;
			const vs = getViewState.call(leaf);
			const raw = vs?.state?.file ?? vs?.state?.path ?? null;
			const path = typeof raw === "string" ? raw : "";
			if (!path) return null;
			const af = view.app.vault.getAbstractFileByPath(path);
			return af instanceof TFile ? af : null;
		} catch {
			return null;
		}
	};

	const tick = () => {
		try {
			if (view.startupRefocusDone) return;
			if (!view.canvas) return;
			// If the user interacts with the timeline (click/pan/zoom/scroll-nav), stop startup refocus
			// permanently so it can't snap the view back to the opened file.
			if (view.shouldSuppressExternalAutoScroll()) {
				view.startupRefocusDone = true;
				clearStartupRefocusTimer(view);
				return;
			}

			const now = performance.now();
			// Give startup-only behavior a bounded window.
			if (now - startedAt > 15_000 || attempts > 80) {
				view.startupRefocusDone = true;
				return;
			}
			attempts += 1;

			let f: TFile | null = null;
			let line: number | null = null;
			let sourceView: any = null;

			// Prefer the remembered markdown leaf (it often becomes the default-note leaf).
			try {
				const noteLeaf: any = (view.plugin as any)?.noteLeaf ?? null;
				const noteView: any = noteLeaf?.view ?? null;
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
					const leaves: any[] = (view.app.workspace as any)?.getLeavesOfType?.("markdown") ?? [];
					const candidates: Array<{ file: TFile; view: any }> = [];
					for (const l of leaves) {
						const v: any = l?.view;
						const file0 = v?.file;
						if (file0 instanceof TFile) {
							candidates.push({ file: file0, view: v });
							continue;
						}
						const fromState = resolveFileFromLeafState(l);
						if (fromState) {
							candidates.push({ file: fromState, view: v });
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
				const af = view.app.workspace.getActiveFile();
				f = af instanceof TFile ? af : null;
			}
			if (!f) {
				view.startupRefocusTimer = window.setTimeout(tick, 250);
				return;
			}
			if ((f.extension?.toLowerCase?.() ?? "") !== "md") {
				view.startupRefocusTimer = window.setTimeout(tick, 250);
				return;
			}

			// Some startup flows (daily note/new note) can create/open a file without triggering
			// a reliable file-open event until the editor gets focus. Proactively ask Epoch's
			// indexer to process it so the timeline can focus it.
			try {
				const maybeIndex = (view.plugin as any)?.maybeIndexOpenedFile;
				if (typeof maybeIndex === "function") {
					void maybeIndex.call(view.plugin, f);
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
				const isKnown = (view.plugin as any)?.indexer?.isFileKnown?.(f.path);
				if (isKnown === false) {
					view.startupRefocusTimer = window.setTimeout(tick, 250);
					return;
				}
			} catch {
				// ignore
			}

			if ((view.canvas as any)?.hasVisibleEntryForFile?.(f.path, line) === true) {
				view.startupRefocusDone = true;
				return;
			}

			// Avoid spamming focus while an animation is in flight.
			if (f.path === lastTriedPath && now - lastTriedAt < 900) {
				view.startupRefocusTimer = window.setTimeout(tick, 250);
				return;
			}
			// On mobile, skip focusing until we know a cursor line; otherwise we can "guess" a
			// tracked-change entry and cause an unexpected jump.
			if (Platform.isMobileApp && line == null) {
				view.startupRefocusTimer = window.setTimeout(tick, 250);
				return;
			}
			lastTriedPath = f.path;
			lastTriedAt = now;
			try {
				(view.canvas as any).suppressNextFocusHover = f.path;
			} catch {
				// ignore
			}
			view.canvas.setActiveFile(f.path, line, { suppressFocus: false });
			view.startupRefocusTimer = window.setTimeout(tick, 250);
		} catch {
			// ignore
			view.startupRefocusTimer = window.setTimeout(tick, 250);
		}
	};

	// Start slightly later to avoid fighting initial layout & indexing.
	view.startupRefocusTimer = window.setTimeout(tick, 600);
}
