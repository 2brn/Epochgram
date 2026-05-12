import { App, Modal, Setting } from "obsidian";

export type MaintenanceChoice = {
	key: string;
	label: string;
	checked: boolean;
	required?: boolean;
	disabled?: boolean;
	disabledReason?: string;
	// When toggled on, auto-check these other keys (if present and not disabled).
	implies?: string[];
	// When toggled on/off, set these other keys to the same value (if present and not disabled).
	toggleWith?: string[];
	// If set, when this choice toggles, also set the parent key to the same value.
	parentKey?: string;
};

export async function promptMaintenanceChoices(
	app: App,
	options: {
		title: string;
		description?: string;
		confirmText: string;
		confirmWarning?: boolean;
		choices: MaintenanceChoice[];
	}
): Promise<Record<string, boolean> | null> {
	return await new Promise((resolve) => {
		const modal = new MaintenanceModal(app, options, resolve);
		modal.open();
	});
}

class MaintenanceModal extends Modal {
	private resolved = false;
	private resolver: (value: Record<string, boolean> | null) => void;
	private titleText: string;
	private descriptionText: string;
	private confirmText: string;
	private confirmWarning: boolean;
	private choices: MaintenanceChoice[];
	private byKey = new Map<string, MaintenanceChoice>();
	private allKey = "__all";
	private priorActiveElement: HTMLElement | null = null;

	constructor(
		app: App,
		options: {
			title: string;
			description?: string;
			confirmText: string;
			confirmWarning?: boolean;
			choices: MaintenanceChoice[];
		},
		resolve: (value: Record<string, boolean> | null) => void
	) {
		super(app);
		this.priorActiveElement = (typeof document !== "undefined" ? (document.activeElement as any) : null) as HTMLElement | null;
		this.titleText = options.title;
		this.descriptionText = options.description ?? "";
		this.confirmText = options.confirmText;
		this.confirmWarning = options.confirmWarning === true;
		this.choices = options.choices.map((c) => ({ ...c }));
		this.resolver = resolve;
		for (const c of this.choices) {
			this.byKey.set(c.key, c);
		}
	}

	private finish(value: Record<string, boolean> | null): void {
		if (this.resolved) return;
		this.resolved = true;
		this.resolver(value);
		this.close();
	}

	private recomputeAllState(): void {
		const all = this.byKey.get(this.allKey);
		if (!all) return;
		let any = false;
		let allChecked = true;
		for (const c of this.choices) {
			if (c.key === this.allKey) continue;
			if (c.disabled) continue;
			any = true;
			if (!c.checked) {
				allChecked = false;
				break;
			}
		}
		all.checked = any ? allChecked : false;
	}

	private applyImplications(choice: MaintenanceChoice): void {
		if (!choice.checked) return;
		const implies = Array.isArray(choice.implies) ? choice.implies : null;
		if (!implies || implies.length === 0) return;
		for (const k of implies) {
			if (!k) continue;
			const other = this.byKey.get(k);
			if (!other) continue;
			if (other.disabled) continue;
			other.checked = true;
		}
	}

	private applyToggleWith(choice: MaintenanceChoice): void {
		const list = Array.isArray(choice.toggleWith) ? choice.toggleWith : null;
		if (!list || list.length === 0) return;
		for (const k of list) {
			if (!k) continue;
			const other = this.byKey.get(k);
			if (!other) continue;
			if (other.disabled) continue;
			if (other.required) {
				other.checked = true;
				continue;
			}
			other.checked = choice.checked;
		}
	}

	private applyParentSync(choice: MaintenanceChoice): void {
		const parentKey = typeof choice.parentKey === "string" ? choice.parentKey : "";
		if (!parentKey) return;
		// Child choices should only be able to turn the parent OFF.
		// This prevents a child being checked from implicitly enabling a broader action.
		if (choice.checked) return;
		const parent = this.byKey.get(parentKey);
		if (!parent) return;
		if (parent.disabled) return;
		if (parent.required) {
			parent.checked = true;
			return;
		}
		parent.checked = false;
	}

	onOpen(): void {
		this.titleEl.setText(this.titleText);
		this.contentEl.empty();
		this.modalEl.addClass("mod-epochgram-maintenance");

		const bodyEl = this.contentEl.createDiv({ cls: "epoch-maintenance-body" });

		if (this.descriptionText) {
			bodyEl.createEl("p", { text: this.descriptionText });
		}

		const listEl = bodyEl.createDiv({ cls: "epoch-maintenance-list" });

		const render = (): void => {
			listEl.empty();
			for (const c of this.choices) {
				const desc = (() => {
					if (c.disabled && c.disabledReason) return c.disabledReason;
					if (c.required) return "Required";
					return "";
				})();
				new Setting(listEl)
					.setName(c.label)
					.setDesc(desc)
					.addToggle((toggle: any) => {
						toggle.setValue(c.checked);
						if (c.required || c.disabled) {
							toggle.setDisabled(true);
						}
						toggle.onChange((value: boolean) => {
							if (c.required || c.disabled) return;
							if (c.key === this.allKey) {
								for (const other of this.choices) {
									if (other.key === this.allKey) continue;
									if (other.disabled) continue;
									if (other.required) {
										other.checked = true;
										continue;
									}
									other.checked = value;
								}
								c.checked = value;
								this.recomputeAllState();
							} else {
								c.checked = value;
								this.applyToggleWith(c);
								this.applyImplications(c);
								this.applyParentSync(c);
								this.recomputeAllState();
							}
							render();
						});
					});
			}
		};

		this.recomputeAllState();
		render();

		if (this.confirmWarning) {
			this.contentEl.createDiv({
				cls: "epoch-maintenance-warning",
				text: "Warning: this action can’t be undone."
			});
		}

		const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
		const confirmButton = buttons.createEl("button", {
			text: this.confirmText,
			cls: this.confirmWarning ? "mod-warning" : "mod-cta"
		});
		confirmButton.setAttr("type", "button");
		confirmButton.addEventListener("click", () => {
			const out: Record<string, boolean> = {};
			for (const c of this.choices) {
				if (c.key === this.allKey) continue;
				if (c.disabled) {
					out[c.key] = false;
					continue;
				}
				out[c.key] = c.required ? true : c.checked;
			}
			this.finish(out);
		});

		const cancelButton = buttons.createEl("button", { text: "Cancel", cls: "mod-cancel" });
		cancelButton.setAttr("type", "button");
		cancelButton.addEventListener("click", () => this.finish(null));
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.resolved) {
			this.resolver(null);
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
					} catch {}
				}
			});
		}
	}
}
