import type { App } from "obsidian";
import { Modal, TFile } from "obsidian";

const activeDocument = window.document;


function getVaultConfigString(app: App, key: string): string | null {
	const vault: any = (app as any)?.vault;
	try {
		if (vault && typeof vault.getConfig === "function") {
			const v = vault.getConfig(key);
			if (typeof v === "string") return v;
		}
	} catch {
		// ignore
	}
	try {
		const v = vault?.config?.[key];
		if (typeof v === "string") return v;
	} catch {
		// ignore
	}
	return null;
}

type DeletedFilesBehavior = "system-trash" | "obsidian-trash" | "permanent" | "unknown";

function getDeletedFilesBehavior(app: App): DeletedFilesBehavior {
	const raw =
		getVaultConfigString(app, "trashOption") ??
		getVaultConfigString(app, "deleteAction") ??
		getVaultConfigString(app, "deletedFiles") ??
		getVaultConfigString(app, "deletedFilesBehavior") ??
		null;

	if (!raw) return "unknown";
	const s = raw.toLowerCase();

	if (s.includes("system")) return "system-trash";
	if (s.includes("permanent") || s === "delete" || s.includes("hard")) return "permanent";
	if (s.includes("trash") || s.includes("local") || s.includes("obsidian") || s.includes("vault")) return "obsidian-trash";

	return "unknown";
}

function deletedFilesBehaviorMessage(app: App): string {
	switch (getDeletedFilesBehavior(app)) {
		case "system-trash":
			return "It will be moved to your system trash.";
		case "obsidian-trash":
			return "It will be moved to your Obsidian trash.";
		case "permanent":
			return "It will be deleted permanently.";
		default:
			return "It will be deleted.";
	}
}

function getPromptDeleteConfig(app: App): boolean | null {
	const vault: any = (app as any)?.vault;
	try {
		if (vault && typeof vault.getConfig === "function") {
			const v = vault.getConfig("promptDelete");
			if (typeof v === "boolean") return v;
		}
	} catch {
		// ignore
	}
	try {
		const v = vault?.config?.promptDelete;
		if (typeof v === "boolean") return v;
	} catch {
		// ignore
	}
	return null;
}

function setPromptDeleteConfig(app: App, value: boolean): void {
	const vault: any = (app as any)?.vault;
	try {
		if (vault && typeof vault.setConfig === "function") {
			vault.setConfig("promptDelete", value);
			return;
		}
	} catch {
		// ignore
	}
	try {
		if (vault && typeof vault.config === "object" && vault.config) {
			vault.config.promptDelete = value;
		}
	} catch {
		// ignore
	}
}

function fileDisplayName(file: TFile): string {
	const anyFile: any = file as any;
	const name = typeof anyFile?.name === "string" ? anyFile.name : "";
	if (name) return name;
	const base = String((file as any)?.basename ?? "");
	const ext = String((file as any)?.extension ?? "");
	if (base && ext) return `${base}.${ext}`;
	return base || String((file as any)?.path ?? "");
}

class DeleteFileConfirmModal extends Modal {
	private fileName: string;
	private shouldDisablePrompt: boolean;
	private resolved = false;
	private resolveChoice: (value: boolean) => void;
	private priorActiveElement: HTMLElement | null = null;

	constructor(app: App, fileName: string, resolve: (value: boolean) => void) {
		super(app);
		this.fileName = fileName;
		this.shouldDisablePrompt = false;
		this.resolveChoice = resolve;
	}

	private finish(value: boolean) {
		if (this.resolved) return;
		this.resolved = true;
		this.resolveChoice(value);
		this.close();
	}

	onOpen() {
		this.priorActiveElement = (typeof activeDocument !== "undefined" ? (activeDocument.activeElement as any) : null) as HTMLElement | null;
		try {
			(this.modalEl as any)?.addClass?.("mod-confirm");
		} catch {
			// ignore
		}

		try {
			(this.titleEl as any)?.setText?.("Delete file");
		} catch {
			// ignore
		}

		try {
			(this.contentEl as any)?.empty?.();
		} catch {
			// ignore
		}

		const contentEl: any = this.contentEl as any;
		if (contentEl?.createEl) {
			contentEl.createEl("p", { text: `Are you sure you want to delete "${this.fileName}"?` });
			contentEl.createEl("p", { text: deletedFilesBehaviorMessage(this.app as any) });
		}

		try {
			const row = contentEl?.createDiv?.({ cls: "epoch-delete-confirm-toggle" });
			const label = row?.createEl?.("label");
			const checkboxEl: HTMLInputElement | null = label?.createEl?.("input", { type: "checkbox" }) ?? null;
			label?.appendText?.(" Don't ask again");
			checkboxEl?.addEventListener?.("change", () => {
				this.shouldDisablePrompt = !!checkboxEl && checkboxEl.checked === true;
			});
		} catch {
			// ignore
		}

		try {
			const buttons = contentEl?.createDiv?.({ cls: "modal-button-container" });
			const deleteBtn = buttons?.createEl?.("button", { text: "Delete", cls: "mod-warning" });
			deleteBtn?.setAttr?.("type", "button");
			deleteBtn?.addEventListener?.("click", () => {
				if (this.shouldDisablePrompt) {
					setPromptDeleteConfig(this.app as any, false);
				}
				this.finish(true);
			});

			const cancelBtn = buttons?.createEl?.("button", { text: "Cancel", cls: "mod-cancel" });
			cancelBtn?.setAttr?.("type", "button");
			cancelBtn?.addEventListener?.("click", () => this.finish(false));
		} catch {
			// ignore
		}
	}

	onClose() {
		try {
			(this.contentEl as any)?.empty?.();
		} catch {
			// ignore
		}
		if (!this.resolved) {
			this.resolveChoice(false);
		}
		const el = this.priorActiveElement;
		this.priorActiveElement = null;
		if (el && typeof el.focus === "function") {
			window.requestAnimationFrame(() => {
				try {
					(el as any).focus?.({ preventScroll: true });
				} catch {
					try {
						el.focus();
					} catch { void 0; }
				}
			});
		}
	}
}

export async function confirmDeleteFileIfNeeded(app: App, file: TFile): Promise<boolean> {
	if (typeof activeDocument === "undefined") {
		return true;
	}

	const enabled = getPromptDeleteConfig(app);
	if (enabled !== true) {
		return true;
	}

	const name = fileDisplayName(file);
	return await new Promise((resolve) => {
		const modal = new DeleteFileConfirmModal(app, name, resolve);
		modal.open();
	});
}