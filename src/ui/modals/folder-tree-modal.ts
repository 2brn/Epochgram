import { App, SuggestModal, TFolder, normalizePath } from "obsidian";

const activeDocument = (typeof window !== "undefined" ? window.document : ({} as Document)) as Document;


export class FolderTreeModal extends SuggestModal<TFolder> {
	private resolveChoice: (folder: TFolder | null) => void;
	private initialFolder: TFolder | null;
	private resolved = false;
	private folders: TFolder[] = [];
	private handleKeyDown: (event: KeyboardEvent) => void;
	private priorActiveElement: HTMLElement | null = null;

	constructor(app: App, initial: TFolder | null, resolve: (folder: TFolder | null) => void) {
		super(app);
		this.priorActiveElement = (typeof activeDocument !== "undefined" ? (activeDocument.activeElement as any) : null) as HTMLElement | null;
		this.resolveChoice = resolve;
		this.initialFolder = initial ?? app.vault.getRoot();
		this.folders = this.collectFolders();
		this.setPlaceholder("Select a folder");
		this.setInstructions([
			{ command: "↑↓", purpose: "to navigate" },
			{ command: "↵", purpose: "to choose" },
			{ command: "shift ↵", purpose: "to create folder" },
			{ command: "esc", purpose: "to dismiss" }
		]);
		this.handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Enter") return;
			const trimmed = this.inputEl.value.trim();
			if (event.shiftKey) {
				event.preventDefault();
				void this.createAndSelectFolder(trimmed);
				return;
			}
			const chooser: any = (this as any).chooser;
			const hasSelection = typeof chooser?.selectedItem === "number" && chooser.selectedItem >= 0;
			if (hasSelection) return;
			event.preventDefault();
			const folder = this.resolveInput(trimmed);
			if (folder) {
				this.finish(folder);
			}
		};
	}

	private collectFolders(): TFolder[] {
		const vault = this.app.vault;
		const rootFolder = vault.getRoot();
		const folders = vault
			.getAllLoadedFiles()
			.filter((item): item is TFolder => item instanceof TFolder);
		if (!folders.includes(rootFolder)) {
			folders.push(rootFolder);
		}
		return folders.sort((a, b) => (a.path || "").localeCompare(b.path || ""));
	}

	onOpen() {
		void super.onOpen();
		this.modalEl.addClass("mod-file-move");
		this.titleEl.setText("Move note to");
		const placeholder = this.initialFolder?.path || "/";
		this.inputEl.placeholder = placeholder || "/";
		this.inputEl.value = "";
		this.inputEl.dispatchEvent(new Event("input"));
		this.inputEl.addEventListener("keydown", this.handleKeyDown);
	}

	onClose() {
		this.inputEl.removeEventListener("keydown", this.handleKeyDown);
		this.modalEl.removeClass("mod-file-move");
		void super.onClose();
		const el = this.priorActiveElement;
		this.priorActiveElement = null;
		window.requestAnimationFrame(() => {
			if (el && typeof el.focus === "function") {
				try {
					(el as any).focus?.({ preventScroll: true });
				} catch {
					try {
						el.focus();
					} catch { void 0; }
				}
			}
			if (this.resolved) return;
			this.resolved = true;
			this.resolveChoice(null);
		});
	}

	getSuggestions(query: string): TFolder[] {
		if (!query) return this.folders;
		const normalized = query.toLowerCase();
		return this.folders.filter((folder) => (folder.path || "/").toLowerCase().includes(normalized));
	}

	renderSuggestion(folder: TFolder, el: HTMLElement) {
		el.setText(folder.path || "/");
	}

	onChooseSuggestion(folder: TFolder) {
		this.finish(folder);
	}

	private finish(folder: TFolder | null) {
		if (this.resolved) return;
		this.resolved = true;
		this.resolveChoice(folder);
		this.close();
	}

	private resolveInput(value: string): TFolder | null {
		const trimmed = value.trim();
		if (!trimmed) {
			return this.initialFolder ?? this.app.vault.getRoot();
		}
		let normalized: string;
		try {
			normalized = normalizePath(trimmed);
		} catch {
			return null;
		}
		if (!normalized || normalized === "." || normalized === "/") {
			return this.app.vault.getRoot();
		}
		const existing = this.app.vault.getAbstractFileByPath(normalized);
		return existing instanceof TFolder ? existing : null;
	}

	private async createAndSelectFolder(path: string) {
		const trimmed = path.trim();
		let normalized: string;
		try {
			normalized = trimmed ? normalizePath(trimmed) : "";
		} catch {
			return;
		}
		const vault = this.app.vault;
		let folder = normalized ? vault.getAbstractFileByPath(normalized) : vault.getRoot();
		if (!(folder instanceof TFolder)) {
			try {
				await vault.createFolder(normalized);
				const created = vault.getAbstractFileByPath(normalized);
				folder = created instanceof TFolder ? created : null;
			} catch {
				folder = null;
			}
		}
		if (folder instanceof TFolder) {
			if (!this.folders.includes(folder)) {
				this.folders.push(folder);
				this.folders.sort((a, b) => (a.path || "").localeCompare(b.path || ""));
			}
			this.finish(folder);
		}
	}
}
