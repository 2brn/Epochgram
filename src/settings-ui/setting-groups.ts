export function createSettingGroup(
	containerEl: HTMLElement,
	title?: string
): { groupEl: HTMLElement; itemsEl: HTMLElement } {
	const groupEl = containerEl.createDiv({ cls: "setting-group" });
	const name = typeof title === "string" ? title.trim() : "";
	if (name) {
		const headingItem = groupEl.createDiv({ cls: "setting-item setting-item-heading" });
		headingItem.createDiv({ cls: "setting-item-name", text: name });
		headingItem.createDiv({ cls: "setting-item-control" });
	}
	const itemsEl = groupEl.createDiv({ cls: "setting-items" });
	return { groupEl, itemsEl };
}
