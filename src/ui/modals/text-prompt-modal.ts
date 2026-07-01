import { App, Modal } from "obsidian";
import { setCssStyles } from "../../dom";

const activeDocument = typeof window !== "undefined" ? window.document : ({} as Document);

type FocusableElement = HTMLElement & {
	focus(options?: FocusOptions): void;
};

function toFocusableElement(value: Element | null): FocusableElement | null {
	return value instanceof HTMLElement ? value : null;
}


export class TextPromptModal extends Modal {
	private titleText: string;
	private initialValue: string;
	private resolver: (value: string | null) => void;
	private submitted = false;
	private priorActiveElement: HTMLElement | null = null;

	constructor(app: App, title: string, initialValue: string, resolve: (value: string | null) => void) {
		super(app);
		this.priorActiveElement = typeof activeDocument !== "undefined"
			? toFocusableElement(activeDocument.activeElement)
			: null;
		this.titleText = title;
		this.initialValue = initialValue;
		this.resolver = resolve;
	}

	private finish(value: string | null) {
		if (this.submitted) return;
		this.submitted = true;
		this.resolver(value);
		this.close();
	}

	onOpen() {
		this.modalEl.addClass("mod-file-rename");
		this.titleEl.setText(this.titleText);
		this.contentEl.empty();
		const content = this.contentEl.createDiv({ cls: "modal-content" });
		const textarea = content.createEl("textarea", {
			cls: "rename-textarea",
			attr: { rows: 1 }
		});
		textarea.value = this.initialValue;
		const autoSize = () => {
			setCssStyles(textarea, { height: "auto" });
			textarea.style.height = `${textarea.scrollHeight}px`;
		};
		autoSize();
		textarea.addEventListener("input", autoSize);
		textarea.addEventListener("keydown", (event) => {
			if (event.key === "Enter" && !event.shiftKey) {
				event.preventDefault();
				this.finish(textarea.value.trim());
			}
			if (event.key === "Escape") {
				event.preventDefault();
				this.finish(null);
			}
		});
		const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
		const saveButton = buttons.createEl("button", { text: "Save", cls: "mod-cta" });
		saveButton.setAttr("type", "button");
		saveButton.addEventListener("click", () => this.finish(textarea.value.trim()));
		const cancelButton = buttons.createEl("button", { text: "Cancel", cls: "mod-cancel" });
		cancelButton.setAttr("type", "button");
		cancelButton.addEventListener("click", () => this.finish(null));
		window.requestAnimationFrame(() => {
			textarea.focus();
			textarea.setSelectionRange(0, textarea.value.length);
		});
	}

	onClose() {
		if (!this.submitted) {
			this.resolver(null);
		}
		this.modalEl.removeClass("mod-file-rename");
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
