export function setCssStyles(el: Element | null | undefined, styles: Partial<CSSStyleDeclaration>): void {
	if (!el) return;
	const maybeEl = el as any;
	if (typeof maybeEl.setCssStyles === "function") {
		maybeEl.setCssStyles(styles);
		return;
	}

	const style = (maybeEl as HTMLElement).style as CSSStyleDeclaration | undefined;
	if (!style) return;

	for (const [key, value] of Object.entries(styles)) {
		if (value == null) continue;
		const s = typeof value === "string" ? value : (typeof value === "number" ? String(value) : "");
		if (!s) continue;
		(style as any)[key] = s;
	}
}
