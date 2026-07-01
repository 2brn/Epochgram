export const DEFAULT_YAML_DATE_PROPERTY = "date";
export const DEFAULT_YAML_DESCRIPTION_PROPERTY = "description";

function escapeRegexLiteral(value: string): string {
	return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isValidFrontmatterPropertyKey(value: string): boolean {
	const key = String(value ?? "").trim();
	return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key);
}

export function normalizeFrontmatterPropertyKey(value: string, fallback: string): string {
	const key = String(value ?? "").trim();
	if (isValidFrontmatterPropertyKey(key)) return key;
	return fallback;
}

function readPluginSettingString(plugin: unknown, key: "yamlDateProperty" | "yamlDescriptionProperty"): string {
	if (!plugin || typeof plugin !== "object") return "";
	const settings = (plugin as { settings?: unknown }).settings;
	if (!settings || typeof settings !== "object") return "";
	const value = (settings as Record<string, unknown>)[key];
	return typeof value === "string" ? value : "";
}

export function getYamlDatePropertyKey(plugin: unknown): string {
	return normalizeFrontmatterPropertyKey(
		readPluginSettingString(plugin, "yamlDateProperty"),
		DEFAULT_YAML_DATE_PROPERTY
	);
}

export function getYamlDescriptionPropertyKey(plugin: unknown): string {
	return normalizeFrontmatterPropertyKey(
		readPluginSettingString(plugin, "yamlDescriptionProperty"),
		DEFAULT_YAML_DESCRIPTION_PROPERTY
	);
}

export function buildFrontmatterPropertyLineRegex(key: string): RegExp {
	return new RegExp(`^\\s*${escapeRegexLiteral(String(key || ""))}\\s*:\\s*(.*?)\\s*$`, "i");
}

export function readFrontmatterProperty(frontmatter: unknown, keyRaw: string): unknown {
	if (!frontmatter || typeof frontmatter !== "object") return null;
	const key = String(keyRaw ?? "").trim();
	if (!key) return null;
	if (Object.prototype.hasOwnProperty.call(frontmatter, key)) {
		return (frontmatter as Record<string, unknown>)[key];
	}
	const target = key.toLowerCase();
	for (const [k, v] of Object.entries(frontmatter as Record<string, unknown>)) {
		if (String(k ?? "").trim().toLowerCase() === target) return v;
	}
	return null;
}
