function toTemplateValue(value: unknown): string {
	if (value == null) return "";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
		return String(value);
	}
	if (value instanceof Date) {
		return Number.isFinite(value.getTime()) ? value.toISOString() : "";
	}
	try {
		const json = JSON.stringify(value);
		return typeof json === "string" ? json : "";
	} catch {
		return "";
	}
}

export function renderAiContextTemplate(
	template: string,
	vars: Record<string, unknown>
): string {
	const tpl = typeof template === "string" ? template : "";
	const dict: Record<string, string> = {};
	for (const [k, v] of Object.entries(vars || {})) {
		dict[k] = toTemplateValue(v);
	}

	const out = tpl
		.replace(/\{\{(\w+)\}\}/g, (m: string, k: string) => (k in dict ? dict[k] : m));

	return out;
}