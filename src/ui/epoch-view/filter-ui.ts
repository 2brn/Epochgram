import { setIcon } from "obsidian";

export type RegisterDomEvent = (
	el: HTMLElement,
	event: string,
	callback: (event: any) => any,
	options?: any
) => void;

export function registerButtonInteractionCleanup(registerDomEvent: RegisterDomEvent, button: HTMLElement | null): void {
	if (!button) return;
	const clearFocus = () => button.blur();
	registerDomEvent(button, "pointerup", clearFocus);
	registerDomEvent(button, "pointercancel", clearFocus);
	registerDomEvent(button, "mouseup", clearFocus);
	registerDomEvent(button, "touchend", clearFocus);
	registerDomEvent(button, "touchcancel", clearFocus);
}

export function setButtonState(button: HTMLElement | null, active: boolean): void {
	if (!button) return;
	button.classList.toggle("is-active", active);
	button.setAttribute("aria-pressed", active ? "true" : "false");
}

export function setButtonDisabled(button: HTMLElement | null, disabled: boolean): void {
	if (!button) return;
	button.classList.toggle("is-disabled", disabled);
	button.setAttribute("aria-disabled", disabled ? "true" : "false");
	button.tabIndex = disabled ? -1 : 0;
}

export function updateFilterPanelState(params: {
	expanded: boolean;
	controlsEl: HTMLElement | null;
	settingsButton: HTMLElement | null;
	filtersPanel: HTMLElement | null;
}): void {
	const { expanded, controlsEl, settingsButton, filtersPanel } = params;
	if (controlsEl) {
		controlsEl.classList.toggle("is-expanded", expanded);
	}
	if (settingsButton) {
		settingsButton.classList.toggle("is-active", expanded);
		settingsButton.setAttribute("aria-pressed", expanded ? "true" : "false");
		settingsButton.setAttribute("aria-expanded", expanded ? "true" : "false");
	}
	if (filtersPanel) {
		filtersPanel.setAttribute("aria-hidden", expanded ? "false" : "true");
	}
}

export function createFilterToggle(params: {
	container: HTMLElement;
	filtersExpanded: boolean;
	registerDomEvent: RegisterDomEvent;
	onToggle: () => void;
}): HTMLElement {
	const { container, filtersExpanded, registerDomEvent, onToggle } = params;
	const button = container.createDiv("graph-controls-button epoch-control-button epoch-filter-button");
	button.setAttribute("role", "button");
	button.setAttribute("tabindex", "0");
	button.setAttribute("aria-label", "Toggle filters");
	button.setAttribute("aria-pressed", filtersExpanded ? "true" : "false");
	button.setAttribute("aria-expanded", filtersExpanded ? "true" : "false");
	const iconEl = button.createSpan({ cls: "epoch-filter-button-icon" });
	setIcon(iconEl, "settings");

	const activate = () => {
		onToggle();
	};

	registerDomEvent(button, "click", activate);
	registerDomEvent(button, "keydown", (event: KeyboardEvent) => {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			activate();
		}
	});
	registerButtonInteractionCleanup(registerDomEvent, button);
	return button;
}

export function createFilterButton(params: {
	container: HTMLElement;
	registerDomEvent: RegisterDomEvent;
	isPro: () => boolean;
	notifyProFeature?: (message: string) => void;
	config: {
		label: string;
		tooltip: string;
		icon?: string;
		onToggle: () => void;
		getValue: () => boolean;
		requiresPro?: boolean;
		proMessage?: string;
	};
}): HTMLElement {
	const { container, registerDomEvent, isPro, notifyProFeature, config } = params;
	const button = container.createDiv("graph-controls-button epoch-control-button epoch-filter-button");
	button.setAttribute("role", "button");
	button.setAttribute("tabindex", "0");
	button.setAttribute("aria-label", config.tooltip);
	button.setAttribute("aria-pressed", config.getValue() ? "true" : "false");
	const iconEl = button.createSpan({ cls: "epoch-filter-button-icon" });
	if (config.icon) {
		setIcon(iconEl, config.icon);
	}

	const activate = () => {
		if (button.classList.contains("is-disabled")) return;
		if (config.requiresPro && !isPro()) {
			if (config.proMessage && notifyProFeature) {
				notifyProFeature(config.proMessage);
			}
			return;
		}
		config.onToggle();
	};

	registerDomEvent(button, "click", activate);
	registerDomEvent(button, "keydown", (event: KeyboardEvent) => {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			activate();
		}
	});
	registerButtonInteractionCleanup(registerDomEvent, button);
	return button;
}
