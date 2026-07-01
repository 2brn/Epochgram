import { App, Modal } from "obsidian";

const activeDocument = typeof window !== "undefined" ? window.document : ({} as Document);

type FocusableElement = HTMLElement & {
	focus(options?: FocusOptions): void;
};

function toFocusableElement(value: Element | null): FocusableElement | null {
	return value instanceof HTMLElement ? value : null;
}


export class ConfirmModal extends Modal {
	private titleText: string;
	private descriptionText: string;
	private yesText: string;
	private noText: string;
	private resolver: (value: boolean) => void;
	private onYes?: () => void;
	private resolved = false;
	private priorActiveElement: HTMLElement | null = null;

	constructor(
		app: App,
		options: {
			title: string;
			description?: string;
			yesText?: string;
			noText?: string;
		},
		onYes: (() => void) | undefined,
		resolve: (value: boolean) => void
	) {
		super(app);
		this.titleText = options.title;
		this.descriptionText = options.description ?? "";
		this.yesText = options.yesText ?? "Yes";
		this.noText = options.noText ?? "No";
		this.onYes = onYes;
		this.resolver = resolve;
	}

	private finish(value: boolean) {
		if (this.resolved) return;
		this.resolved = true;
		this.resolver(value);
		this.close();
	}

	onOpen() {
		this.priorActiveElement = typeof activeDocument !== "undefined"
			? toFocusableElement(activeDocument.activeElement)
			: null;
		this.modalEl.addClass("mod-epochgram-topic");
		this.titleEl.setText(this.titleText);
		this.contentEl.empty();
		if (this.descriptionText) {
			this.contentEl.createEl("p", { text: this.descriptionText });
		}
		const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
		const yesButton = buttons.createEl("button", { text: this.yesText, cls: "mod-cta" });
		yesButton.setAttr("type", "button");
		yesButton.addEventListener("click", () => {
			try {
				this.onYes?.();
			} catch { void 0; }
			this.finish(true);
		});
		const noButton = buttons.createEl("button", { text: this.noText, cls: "mod-cancel" });
		noButton.setAttr("type", "button");
		noButton.addEventListener("click", () => this.finish(false));
	}

	onClose() {
		this.contentEl.empty();
		if (!this.resolved) {
			this.resolver(false);
		}
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

export function confirmModal(
	app: App,
	options: { title: string; description?: string; yesText?: string; noText?: string }
): Promise<boolean> {
	return new Promise((resolve) => {
		const modal = new ConfirmModal(app, options, undefined, resolve);
		modal.open();
	});
}
