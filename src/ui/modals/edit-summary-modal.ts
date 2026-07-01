import { App, Modal, Notice } from "obsidian";
import { truncateToChars } from "./text-utils";
import { setCssStyles } from "../../dom";

const activeDocument = typeof window !== "undefined" ? window.document : ({} as Document);

type FocusableElement = HTMLElement & {
	focus(options?: FocusOptions): void;
};

function toFocusableElement(value: Element | null): FocusableElement | null {
	return value instanceof HTMLElement ? value : null;
}


export class EditSummaryModal extends Modal {
	private titleText: string;
	private initialValue: string;
	private maxChars: number;
	private resolver: (value: string | null) => void;
	private submitted = false;
	private lastWarnAt = 0;
	private priorActiveElement: HTMLElement | null = null;

	constructor(
		app: App,
		options: { title: string; initialValue: string; maxWords: number; maxChars: number },
		resolve: (value: string | null) => void
	) {
		super(app);
		this.titleText = options.title;
		this.initialValue = options.initialValue;
		this.maxChars = Math.max(1, Math.floor(options.maxChars || 200));
		this.resolver = resolve;
	}

	private finish(value: string | null) {
		if (this.submitted) return;
		this.submitted = true;
		this.resolver(value);
		this.close();
	}

	onOpen() {
		this.priorActiveElement = typeof activeDocument !== "undefined"
			? toFocusableElement(activeDocument.activeElement)
			: null;
		this.modalEl.addClass("mod-file-rename");
		this.modalEl.addClass("mod-epochgram-edit-summary");
		this.titleEl.setText(this.titleText);
		this.contentEl.empty();
		const content = this.contentEl.createDiv({ cls: "modal-content" });
		const textarea = content.createEl("textarea", {
			cls: "rename-textarea",
			attr: { rows: 1, maxlength: String(this.maxChars) }
		});
		textarea.value = truncateToChars(this.initialValue, this.maxChars);

		const autoSize = () => {
			setCssStyles(textarea, { height: "auto" });
			textarea.style.height = `${textarea.scrollHeight}px`;
		};
		const enforce = () => {
			const before = textarea.value;
			const next = truncateToChars(before, this.maxChars);
			if (next !== before) {
				textarea.value = next;
				const now = Date.now();
				if (now - this.lastWarnAt > 1500) {
					this.lastWarnAt = now;
					new Notice(`Summary is limited to ${this.maxChars} characters.`);
				}
			}
		};

		autoSize();
		textarea.addEventListener("input", () => {
			enforce();
			autoSize();
		});
		textarea.addEventListener("keydown", (event) => {
			if (event.key === "Enter" && !event.shiftKey) {
				event.preventDefault();
				this.finish(truncateToChars(textarea.value.trim(), this.maxChars));
			}
			if (event.key === "Escape") {
				event.preventDefault();
				this.finish(null);
			}
		});

		const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
		const saveButton = buttons.createEl("button", { text: "Save", cls: "mod-cta" });
		saveButton.setAttr("type", "button");
		saveButton.addEventListener("click", () => {
			const v = truncateToChars(textarea.value.trim(), this.maxChars);
			this.finish(v);
		});
		const cancelButton = buttons.createEl("button", { text: "Cancel", cls: "mod-cancel" });
		cancelButton.setAttr("type", "button");
		cancelButton.addEventListener("click", () => this.finish(null));

		window.requestAnimationFrame(() => {
			try {
				textarea.focus({ preventScroll: true });
			} catch {
				textarea.focus();
			}
			textarea.setSelectionRange(0, textarea.value.length);
		});
	}

	onClose() {
		if (!this.submitted) {
			this.resolver(null);
		}
		this.modalEl.removeClass("mod-file-rename");
		this.modalEl.removeClass("mod-epochgram-edit-summary");
		this.contentEl.empty();
		const el = this.priorActiveElement;
		this.priorActiveElement = null;
		if (el && typeof el.focus === "function") {
			window.requestAnimationFrame(() => {
				try {
					(el as FocusableElement).focus({ preventScroll: true });
				} catch {
					try {
						el.focus();
					} catch { void 0; }
				}
			});
		}
	}
}

export function promptEditSummary(
	app: App,
	options: { title?: string; initialValue: string; maxWords?: number; maxChars?: number }
): Promise<string | null> {
	return new Promise((resolve) => {
		const modal = new EditSummaryModal(
			app,
			{
				title: options.title ?? "Edit summary",
				initialValue: options.initialValue,
				maxWords: options.maxWords ?? 10,
				maxChars: options.maxChars ?? 100
			},
			resolve
		);
		modal.open();
	});
}
