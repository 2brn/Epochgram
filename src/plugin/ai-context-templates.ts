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

export function renderAiContextTemplate(
	template: string,
	vars: Record<string, any>
): string {
	const tpl = typeof template === "string" ? template : "";
	const dict: Record<string, string> = {};
	for (const [k, v] of Object.entries(vars || {})) {
		dict[k] = v == null ? "" : String(v);
	}

	const out = tpl
		.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in dict ? dict[k] : m));

	return out;
}