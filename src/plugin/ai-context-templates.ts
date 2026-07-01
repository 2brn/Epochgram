export const DEFAULT_SUMMARY_CONTEXT_TEMPLATE =
	"Ignore dates\n" +
	"Ignore empty content\n" +
	"Treat the input as the only source of facts; do not add new information\n\n" +
	"{{filePath}}\n\n" +
	"Related context:\n" +
	"{{related}}";

export const DEFAULT_EPOCH_CONTEXT_TEMPLATE =
	"Ignore dates\n" +
	"Ignore empty content\n" +
	"Treat the input as the only source of facts; do not add new information\n" +
	"Ouput max 7 words per line\n\n" +
	"Related context:\n" +
	"{{related}}";

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