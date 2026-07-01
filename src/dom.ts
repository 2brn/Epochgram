export function setCssStyles(el: Element | null | undefined, styles: Partial<CSSStyleDeclaration>): void {
	if (!el) return;
	const styledEl = el as Element & { setCssStyles?: (styles: Partial<CSSStyleDeclaration>) => void };
	if (typeof styledEl.setCssStyles === "function") {
		styledEl.setCssStyles(styles);
		return;
	}

	const style = (styledEl as HTMLElement).style as CSSStyleDeclaration | undefined;
	if (!style) return;

	for (const [key, value] of Object.entries(styles)) {
		if (value == null) continue;
		const s = typeof value === "string" ? value : (typeof value === "number" ? String(value) : "");
		if (!s) continue;
		(style as CSSStyleDeclaration & Record<string, string>)[key] = s;
	}
}
