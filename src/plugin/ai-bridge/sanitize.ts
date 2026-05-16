import * as YAML from "yaml";
import defaultBridgeSettingsYaml from "epochgram-bridge-default-settings-yaml";

type AiBridgeServerState = {
	token: string;
	port?: number;
};

export function sanitizeBridgeServerState(input: any): AiBridgeServerState | null {
	if (!input || typeof input !== "object") return null;
	const token = typeof (input as any).token === "string" ? String((input as any).token) : "";
	if (!token || token.length < 16 || token.length > 128) return null;
	const portRaw = (input as any).port;
	const port = typeof portRaw === "number" && Number.isFinite(portRaw) ? Math.floor(portRaw) : null;
	const cleanPort = port != null && port >= 1024 && port <= 65535 ? port : undefined;
	return { token, port: cleanPort };
}

const TYPE_VALUES = new Set(["key-points", "tldr", "teaser", "headline"]);
const FORMAT_VALUES = new Set(["markdown", "plain-text"]);
const LENGTH_VALUES = new Set(["short", "medium", "long"]);
const PREFERENCE_VALUES = new Set(["auto", "speed", "capability"]);
const PERIOD_ORDER = ["day", "2days", "4days", "week", "2weeks", "month", "3months", "6months", "year"] as const;
const ROOT_KEYS = new Set(["sharedContext", "type", "format", "length", "preference", "expectedInputLanguages", "outputLanguage", "expectedContextLanguages", "maxRelatedChars", "maxOutputWords", "reduce", "records", "epochs"]);
const BLOCK_KEYS = ["context", "type", "format", "length", "preference", "expectedInputLanguages", "outputLanguage", "expectedContextLanguages", "maxOutputWords"] as const;
const REDUCE_KEYS = new Set([...BLOCK_KEYS, "maxDepth", "maxChunkChars"]);
const RECORDS_KEYS = new Set([...BLOCK_KEYS, "maxInputChars"]);
const EPOCH_KEYS = new Set(["period", ...BLOCK_KEYS, "maxFileChars"]);
const SHARED_CONTEXT_ALLOWED_PLACEHOLDERS = new Set<string>();
const REDUCE_CONTEXT_ALLOWED_PLACEHOLDERS = new Set<string>();
const RECORDS_CONTEXT_ALLOWED_PLACEHOLDERS = new Set(["filePath", "fileName", "related"]);
const EPOCH_CONTEXT_ALLOWED_PLACEHOLDERS = new Set(["related"]);
const SUPPORTED_LANGUAGES = new Set(["en", "ja", "es"]);
const PERIOD_ALIASES: Record<string, (typeof PERIOD_ORDER)[number]> = {
	day: "day",
	"2days": "2days",
	"4day": "4days",
	"4days": "4days",
	week: "week",
	"2weeks": "2weeks",
	month: "month",
	"3month": "3months",
	"3months": "3months",
	"6month": "6months",
	"6months": "6months",
	year: "year"
};

type BridgeLanguage = string;
type BridgeKind = "key-points" | "tldr" | "teaser" | "headline";
type BridgeFormat = "markdown" | "plain-text";
type BridgeLength = "short" | "medium" | "long";
type BridgePreference = "auto" | "speed" | "capability";

type BridgeTuningFields = {
	maxInputChars?: number;
	maxRelatedChars?: number;
	maxOutputWords?: number;
	maxDepth?: number;
	maxChunkChars?: number;
	maxFileChars?: number;
};

export type BridgeSettingsBlock = {
	type: BridgeKind;
	format: BridgeFormat;
	length: BridgeLength;
	preference: BridgePreference;
	expectedInputLanguages: BridgeLanguage[];
	outputLanguage: BridgeLanguage;
	expectedContextLanguages: BridgeLanguage[];
	context?: string;
	maxOutputWords?: number;
};

export type BridgeSettingsOverride = Partial<BridgeSettingsBlock> & BridgeTuningFields;

export type BridgeEpochRule = BridgeSettingsOverride & {
	period: string;
};

export type BridgeResolvedSettings = BridgeSettingsBlock & {
	sharedContext: string;
	maxRelatedChars: number;
	maxOutputWords?: number;
	reduce?: BridgeSettingsOverride;
	records?: BridgeSettingsOverride;
	epochs: BridgeEpochRule[];
};

export type BridgeOptionsState = {
	settingsYaml: string;
};

export type BridgeOptionsValidation = {
	valid: boolean;
	errors: string[];
	warnings: string[];
	formattedUserYaml: string;
	formattedMergedYaml: string;
	resolved: BridgeResolvedSettings;
	stored: BridgeOptionsState;
};

function normalizePositiveInteger(raw: any): number | null {
	if (typeof raw === "number" && Number.isFinite(raw)) {
		const n = Math.floor(raw);
		return n > 0 ? n : null;
	}
	if (typeof raw === "string") {
		const trimmed = String(raw).trim();
		if (!/^\d+$/.test(trimmed)) return null;
		const n = Number(trimmed);
		return Number.isSafeInteger(n) && n > 0 ? n : null;
	}
	return null;
}

function checkUnknownKeys(name: string, obj: Record<string, any>, allowed: Set<string>, errors: string[]) {
	for (const key of Object.keys(obj)) {
		if (!allowed.has(key)) errors.push(`${name}: unknown property '${key}'`);
	}
}

function collectDoubleBracePlaceholders(input: string): string[] {
	const src = String(input || "");
	const out: string[] = [];
	const seen = new Set<string>();
	const re = /\{\{(\w+)\}\}/g;
	let m: RegExpExecArray | null = null;
	while ((m = re.exec(src))) {
		const key = String(m[1] || "");
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push(key);
	}
	return out;
}

function hasEmptyDoubleBracePlaceholder(input: string): boolean {
	const src = String(input || "");
	return /\{\{\s*\}\}/.test(src);
}

function getSupportedPlaceholdersLabel(contextType?: "shared" | "reduce" | "records" | "epoch"): string {
	if (contextType === "reduce") return "none";
	if (contextType === "records") return "{{filePath}}, {{fileName}}, {{related}}";
	if (contextType === "epoch") return "{{related}}";
	if (contextType === "shared") return "none";
	return "none";
}

function applyPositiveIntegerField(
	name: string,
	raw: Record<string, any>,
	key: keyof BridgeTuningFields,
	errors: string[],
	out: Record<string, any>
) {
	if (!hasOwn(raw, key)) return;
	if (isEmptyYamlScalar(raw[key])) {
		errors.push(`${name}.${key} cannot be empty`);
		return;
	}
	const normalized = normalizePositiveInteger(raw[key]);
	if (normalized == null) {
		errors.push(`${name}.${key} must be a positive integer`);
		return;
	}
	out[key] = normalized;
}

function applyOptionalPositiveIntegerField(
	name: string,
	raw: Record<string, any>,
	key: keyof BridgeTuningFields,
	errors: string[],
	out: Record<string, any>
) {
	if (!hasOwn(raw, key)) return;
	if (isEmptyYamlScalar(raw[key])) return;
	const normalized = normalizePositiveInteger(raw[key]);
	if (normalized == null) {
		errors.push(`${name}.${key} must be a positive integer`);
		return;
	}
	out[key] = normalized;
}

function readPositiveIntegerOrDefault(rawValue: any, defaultValue: any): number {
	const normalized = normalizePositiveInteger(rawValue);
	if (normalized != null) return normalized;
	const fallback = normalizePositiveInteger(defaultValue);
	return fallback ?? 0;
}

function validateContextPlaceholders(name: string, text: string, errors: string[], contextType?: "shared" | "reduce" | "records" | "epoch") {
	const src = String(text || "");
	if (!src) return;
	if (hasEmptyDoubleBracePlaceholder(src)) {
		errors.push(`${name}: empty placeholder '{{ }}' is not supported`);
	}

	const allowedForType =
		contextType === "reduce" ? REDUCE_CONTEXT_ALLOWED_PLACEHOLDERS :
		contextType === "records" ? RECORDS_CONTEXT_ALLOWED_PLACEHOLDERS :
		contextType === "epoch" ? EPOCH_CONTEXT_ALLOWED_PLACEHOLDERS :
		contextType === "shared" ? SHARED_CONTEXT_ALLOWED_PLACEHOLDERS :
		null;

	for (const key of collectDoubleBracePlaceholders(src)) {
		if (key === "bucket") {
			errors.push(`${name}: placeholder '{{bucket}}' is not supported`);
			continue;
		}
		if (allowedForType && !allowedForType.has(key)) {
			const supported = getSupportedPlaceholdersLabel(contextType);
			errors.push(`${name}: placeholder must be one of: ${supported}`);
		}
	}
}

function replaceNullScalarsWithEmptyString(value: any): any {
	if (value === null) return "";
	if (Array.isArray(value)) return value.map((item) => replaceNullScalarsWithEmptyString(item));
	if (!value || typeof value !== "object") return value;
	const out: Record<string, any> = {};
	for (const [k, v] of Object.entries(value)) {
		out[k] = replaceNullScalarsWithEmptyString(v);
	}
	return out;
}

function parseYamlObject(raw: string): Record<string, any> {
	const doc = replaceNullScalarsWithEmptyString(YAML.parse(String(raw || "")));
	if (!doc || typeof doc !== "object" || Array.isArray(doc)) return {};
	return doc as Record<string, any>;
}

function deepMerge(base: any, override: any): any {
	if (Array.isArray(base) || Array.isArray(override)) {
		return override == null ? base : override;
	}
	if (!base || typeof base !== "object") return override == null ? base : override;
	if (!override || typeof override !== "object") return override == null ? base : override;
	const out: Record<string, any> = { ...base };
	for (const key of Object.keys(override)) {
		out[key] = deepMerge((base as any)[key], (override as any)[key]);
	}
	return out;
}

function asYamlString(value: any): string {
	return YAML.stringify(value, {
		lineWidth: 0,
		sortMapEntries: false,
		aliasDuplicateObjects: false,
		simpleKeys: false
	}).trim() + "\n";
}

function canonicalizeLanguageTag(raw: any): string | null {
	if (typeof raw !== "string") return null;
	const v = String(raw).trim().replace(/_/g, "-");
	if (!v) return null;
	try {
		const list = Intl.getCanonicalLocales(v);
		return Array.isArray(list) && list.length > 0 ? String(list[0]) : null;
	} catch {
		return null;
	}
}

function normalizeSupportedLanguageCode(raw: any): string | null {
	const canonical = canonicalizeLanguageTag(raw);
	if (!canonical) return null;
	const base = String(canonical).toLowerCase().split(/[-_]/)[0] || "";
	if (!base) return null;
	return SUPPORTED_LANGUAGES.has(base) ? base : null;
}

function normalizeLang(raw: any, fallback: BridgeLanguage = "en"): BridgeLanguage {
	return normalizeSupportedLanguageCode(raw) || normalizeSupportedLanguageCode(fallback) || "en";
}

function normalizeLangList(raw: any, fallback: BridgeLanguage[]): BridgeLanguage[] {
	const arr = Array.isArray(raw) ? raw : (typeof raw === "string" ? [raw] : []);
	const out: BridgeLanguage[] = [];
	const seen = new Set<string>();
	for (const item of arr) {
		const n = normalizeSupportedLanguageCode(item);
		if (!n) continue;
		if (seen.has(n)) continue;
		seen.add(n);
		out.push(n);
	}
	if (out.length > 0) return out;
	const fb = fallback
		.map((v) => normalizeLang(v))
		.filter((v, i, a) => a.indexOf(v) === i);
	return fb.length > 0 ? fb : ["en"];
}

function normalizeType(raw: any): BridgeKind {
	const v = typeof raw === "string" ? raw : "";
	return TYPE_VALUES.has(v) ? (v as BridgeKind) : "headline";
}

function normalizeFormat(raw: any): BridgeFormat {
	const v = typeof raw === "string" ? raw : "";
	return FORMAT_VALUES.has(v) ? (v as BridgeFormat) : "plain-text";
}

function normalizeLength(raw: any): BridgeLength {
	const v = typeof raw === "string" ? raw : "";
	return LENGTH_VALUES.has(v) ? (v as BridgeLength) : "short";
}

function normalizePreference(raw: any): BridgePreference {
	const v = typeof raw === "string" ? raw : "";
	return PREFERENCE_VALUES.has(v) ? (v as BridgePreference) : "auto";
}

function normalizePeriod(raw: any): string {
	const v = String(raw || "").trim().toLowerCase();
	if (!v) return "";
	if (v.includes("-")) {
		const [aRaw, bRaw] = v.split("-");
		const a = PERIOD_ALIASES[String(aRaw || "").trim()];
		const b = PERIOD_ALIASES[String(bRaw || "").trim()];
		if (!a || !b) return "";
		return `${a}-${b}`;
	}
	return PERIOD_ALIASES[v] ?? "";
}

function getPeriodBounds(period: string): [number, number] | null {
	const v = normalizePeriod(period);
	if (!v) return null;
	if (!v.includes("-")) {
		const idx = PERIOD_ORDER.indexOf(v as any);
		return idx >= 0 ? [idx, idx] : null;
	}
	const [a, b] = v.split("-") as [(typeof PERIOD_ORDER)[number], (typeof PERIOD_ORDER)[number]];
	const i = PERIOD_ORDER.indexOf(a);
	const j = PERIOD_ORDER.indexOf(b);
	if (i < 0 || j < 0 || i > j) return null;
	return [i, j];
}

function hasOwn(obj: any, key: string): boolean {
	return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function isEmptyYamlScalar(value: any): boolean {
	if (value == null) return true;
	if (typeof value === "string" && !value.trim()) return true;
	return false;
}

function validateExplicitEmptyFields(
	name: string,
	raw: any,
	errors: string[],
	opts?: { allowContext?: boolean; numericKeys?: Array<keyof BridgeTuningFields> }
) {
	const allowContext = opts?.allowContext === true;
	const numericKeys = Array.isArray(opts?.numericKeys) ? opts.numericKeys : [];
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
	if (hasOwn(raw, "type") && isEmptyYamlScalar(raw.type)) {
		errors.push(`${name}.type cannot be empty`);
	}
	if (hasOwn(raw, "format") && isEmptyYamlScalar(raw.format)) {
		errors.push(`${name}.format cannot be empty`);
	}
	if (hasOwn(raw, "length") && isEmptyYamlScalar(raw.length)) {
		errors.push(`${name}.length cannot be empty`);
	}
	if (hasOwn(raw, "preference") && isEmptyYamlScalar(raw.preference)) {
		errors.push(`${name}.preference cannot be empty`);
	}
	if (hasOwn(raw, "outputLanguage") && isEmptyYamlScalar(raw.outputLanguage)) {
		errors.push(`${name}.outputLanguage cannot be empty`);
	}
	if (allowContext && hasOwn(raw, "context") && isEmptyYamlScalar(raw.context)) {
		errors.push(`${name}.context cannot be empty`);
	}
	for (const key of numericKeys) {
		if (hasOwn(raw, key) && isEmptyYamlScalar(raw[key])) {
			errors.push(`${name}.${key} cannot be empty`);
		}
	}
}

function validateBlock(name: string, block: any, errors: string[], opts?: { allowContext?: boolean; defaultMissing?: boolean }): BridgeSettingsBlock | BridgeSettingsOverride {
	const allowContext = opts?.allowContext === true;
	const defaultMissing = opts?.defaultMissing === true;
	const raw = block && typeof block === "object" ? block : {};
	const out: BridgeSettingsOverride = {};
	if (defaultMissing || raw.type != null) out.type = normalizeType(raw.type);
	if (defaultMissing || raw.format != null) out.format = normalizeFormat(raw.format);
	if (defaultMissing || raw.length != null) out.length = normalizeLength(raw.length);
	if (defaultMissing || raw.preference != null) out.preference = normalizePreference(raw.preference);
	if (defaultMissing || raw.expectedInputLanguages != null) out.expectedInputLanguages = normalizeLangList(raw.expectedInputLanguages, ["en", "ja", "es"]);
	if (defaultMissing || raw.outputLanguage != null) out.outputLanguage = normalizeLang(raw.outputLanguage);
	if (defaultMissing || raw.expectedContextLanguages != null) out.expectedContextLanguages = normalizeLangList(raw.expectedContextLanguages, ["en"]);
	if (allowContext && typeof raw.context === "string") out.context = raw.context;
	applyOptionalPositiveIntegerField(name, raw, "maxOutputWords", errors, out as Record<string, any>);

	if (hasOwn(raw, "type") && isEmptyYamlScalar(raw.type)) {
		errors.push(`${name}.type cannot be empty`);
	}
	if (hasOwn(raw, "format") && isEmptyYamlScalar(raw.format)) {
		errors.push(`${name}.format cannot be empty`);
	}
	if (hasOwn(raw, "length") && isEmptyYamlScalar(raw.length)) {
		errors.push(`${name}.length cannot be empty`);
	}
	if (hasOwn(raw, "preference") && isEmptyYamlScalar(raw.preference)) {
		errors.push(`${name}.preference cannot be empty`);
	}
	if (hasOwn(raw, "outputLanguage") && isEmptyYamlScalar(raw.outputLanguage)) {
		errors.push(`${name}.outputLanguage cannot be empty`);
	}
	if (allowContext && hasOwn(raw, "context") && isEmptyYamlScalar(raw.context)) {
		errors.push(`${name}.context cannot be empty`);
	}
	if (hasOwn(raw, "expectedInputLanguages") && !Array.isArray(raw.expectedInputLanguages)) {
		errors.push(`${name}.expectedInputLanguages must be a YAML list`);
	}
	if (hasOwn(raw, "expectedContextLanguages") && !Array.isArray(raw.expectedContextLanguages)) {
		errors.push(`${name}.expectedContextLanguages must be a YAML list`);
	}

	if (raw.type != null && !TYPE_VALUES.has(String(raw.type))) errors.push(`${name}.type must be one of: key-points, tldr, teaser, headline`);
	if (raw.format != null && !FORMAT_VALUES.has(String(raw.format))) errors.push(`${name}.format must be one of: markdown, plain-text`);
	if (raw.length != null && !LENGTH_VALUES.has(String(raw.length))) errors.push(`${name}.length must be one of: short, medium, long`);
	if (raw.preference != null && !PREFERENCE_VALUES.has(String(raw.preference))) errors.push(`${name}.preference must be one of: auto, speed, capability`);
	if (raw.outputLanguage != null) {
		if (!normalizeSupportedLanguageCode(raw.outputLanguage)) errors.push(`${name}.outputLanguage must be one of: en, ja, es`);
	}
	if (raw.expectedInputLanguages != null && !Array.isArray(raw.expectedInputLanguages)) {
		errors.push(`${name}.expectedInputLanguages must be a YAML list`);
	} else if (Array.isArray(raw.expectedInputLanguages)) {
		const seenInput = new Set<string>();
		for (let i = 0; i < raw.expectedInputLanguages.length; i++) {
			const canonical = normalizeSupportedLanguageCode(raw.expectedInputLanguages[i]);
			if (!canonical) {
				errors.push(`${name}.expectedInputLanguages[${i}] must be one of: en, ja, es`);
				continue;
			}
			if (seenInput.has(canonical)) {
				errors.push(`${name}.expectedInputLanguages[${i}] duplicates '${canonical}'`);
				continue;
			}
			seenInput.add(canonical);
		}
	}
	if (raw.expectedContextLanguages != null && !Array.isArray(raw.expectedContextLanguages)) {
		errors.push(`${name}.expectedContextLanguages must be a YAML list`);
	} else if (Array.isArray(raw.expectedContextLanguages)) {
		const seenContext = new Set<string>();
		for (let i = 0; i < raw.expectedContextLanguages.length; i++) {
			const canonical = normalizeSupportedLanguageCode(raw.expectedContextLanguages[i]);
			if (!canonical) {
				errors.push(`${name}.expectedContextLanguages[${i}] must be one of: en, ja, es`);
				continue;
			}
			if (seenContext.has(canonical)) {
				errors.push(`${name}.expectedContextLanguages[${i}] duplicates '${canonical}'`);
				continue;
			}
			seenContext.add(canonical);
		}
	}
	return defaultMissing ? (out as BridgeSettingsBlock) : out;
}

function validateReduceBlock(name: string, block: any, errors: string[]): BridgeSettingsOverride {
	const out = validateBlock(name, block, errors, { allowContext: true }) as BridgeSettingsOverride;
	const raw = block && typeof block === "object" && !Array.isArray(block) ? block as Record<string, any> : {};
	applyPositiveIntegerField(name, raw, "maxDepth", errors, out as Record<string, any>);
	applyPositiveIntegerField(name, raw, "maxChunkChars", errors, out as Record<string, any>);
	return out;
}

function validateRecordsBlock(name: string, block: any, errors: string[]): BridgeSettingsOverride {
	const out = validateBlock(name, block, errors, { allowContext: true }) as BridgeSettingsOverride;
	const raw = block && typeof block === "object" && !Array.isArray(block) ? block as Record<string, any> : {};
	applyPositiveIntegerField(name, raw, "maxInputChars", errors, out as Record<string, any>);
	return out;
}

function validateEpochRuleBlock(name: string, block: any, errors: string[]): BridgeSettingsOverride {
	const out = validateBlock(name, block, errors, { allowContext: true }) as BridgeSettingsOverride;
	const raw = block && typeof block === "object" && !Array.isArray(block) ? block as Record<string, any> : {};
	applyPositiveIntegerField(name, raw, "maxFileChars", errors, out as Record<string, any>);
	return out;
}

export function validateBridgeOptionsYaml(settingsYamlRaw: string): BridgeOptionsValidation {
	const errors: string[] = [];
	const warnings: string[] = [];
	const userYaml = String(settingsYamlRaw || "").trim();
	let userObj: Record<string, any> = {};
	let defaultObj: Record<string, any> = {};

	try {
		defaultObj = parseYamlObject(defaultBridgeSettingsYaml);
	} catch (err: any) {
		errors.push(`Default settings YAML is invalid: ${String(err?.message || err)}`);
	}

	if (userYaml) {
		try {
			userObj = parseYamlObject(userYaml);
		} catch (err: any) {
			errors.push(`settings YAML parse error: ${String(err?.message || err)}`);
		}
	}

	if (Object.keys(userObj).length > 0) {
		checkUnknownKeys("root", userObj, ROOT_KEYS, errors);
		validateExplicitEmptyFields("root", userObj, errors, { numericKeys: ["maxRelatedChars"] });
		if (userObj.reduce && typeof userObj.reduce === "object" && !Array.isArray(userObj.reduce)) {
			checkUnknownKeys("reduce", userObj.reduce as Record<string, any>, REDUCE_KEYS, errors);
			validateExplicitEmptyFields("reduce", userObj.reduce, errors, { allowContext: true, numericKeys: ["maxDepth", "maxChunkChars"] });
		}
		if (userObj.records && typeof userObj.records === "object" && !Array.isArray(userObj.records)) {
			checkUnknownKeys("records", userObj.records as Record<string, any>, RECORDS_KEYS, errors);
			validateExplicitEmptyFields("records", userObj.records, errors, { allowContext: true, numericKeys: ["maxInputChars"] });
		}
		if (Array.isArray(userObj.epochs)) {
			for (let i = 0; i < userObj.epochs.length; i++) {
				const ep = userObj.epochs[i];
				if (ep && typeof ep === "object" && !Array.isArray(ep)) {
					checkUnknownKeys(`epochs[${i}]`, ep as Record<string, any>, EPOCH_KEYS, errors);
					validateExplicitEmptyFields(`epochs[${i}]`, ep, errors, { allowContext: true, numericKeys: ["maxFileChars"] });
				}
			}
		}
	}

	const merged = deepMerge(defaultObj, userObj);
	const rootBlock = validateBlock("root", merged, errors, { defaultMissing: true }) as BridgeSettingsBlock;
	const sharedContext = typeof merged.sharedContext === "string" ? merged.sharedContext : "";
	if (hasOwn(merged, "maxRelatedChars")) {
		applyPositiveIntegerField("root", merged as Record<string, any>, "maxRelatedChars", errors, merged as Record<string, any>);
	}
	const maxRelatedChars = readPositiveIntegerOrDefault((merged as Record<string, any>).maxRelatedChars, defaultObj.maxRelatedChars);
	const maxOutputWords = readPositiveIntegerOrDefault((merged as Record<string, any>).maxOutputWords, defaultObj.maxOutputWords);
	if (merged.sharedContext != null && typeof merged.sharedContext !== "string") {
		errors.push("sharedContext must be a string block");
	}
	validateContextPlaceholders("sharedContext", sharedContext, errors, "shared");

	let reduce: BridgeSettingsOverride | undefined;
	if (merged.reduce != null) {
		reduce = validateReduceBlock("reduce", merged.reduce, errors);
		validateContextPlaceholders("reduce.context", String(reduce.context || ""), errors, "reduce");
	}

	let records: BridgeSettingsOverride | undefined;
	if (merged.records != null) {
		records = validateRecordsBlock("records", merged.records, errors);
		validateContextPlaceholders("records.context", String(records.context || ""), errors, "records");
	}

	const epochsRaw = Array.isArray(merged.epochs) ? merged.epochs : [];
	const epochs: BridgeEpochRule[] = [];
	const periodSeen = new Set<string>();
	const covered: Array<{ period: string; start: number; end: number }> = [];
	for (let i = 0; i < epochsRaw.length; i++) {
		const rec = epochsRaw[i] && typeof epochsRaw[i] === "object" ? epochsRaw[i] : {};
		const normalizedPeriod = normalizePeriod((rec as any).period);
		if (!normalizedPeriod) {
			errors.push(`epochs[${i}].period is invalid`);
			continue;
		}
		if (periodSeen.has(normalizedPeriod)) {
			errors.push(`epochs[${i}].period duplicates '${normalizedPeriod}'`);
			continue;
		}
		periodSeen.add(normalizedPeriod);
		const bounds = getPeriodBounds(normalizedPeriod);
		if (!bounds) {
			errors.push(`epochs[${i}].period '${normalizedPeriod}' is invalid`);
			continue;
		}
		for (const prev of covered) {
			const overlaps = Math.max(bounds[0], prev.start) <= Math.min(bounds[1], prev.end);
			if (overlaps) {
				errors.push(`epochs[${i}].period '${normalizedPeriod}' overlaps with '${prev.period}'`);
				break;
			}
		}
		covered.push({ period: normalizedPeriod, start: bounds[0], end: bounds[1] });
		const b = validateEpochRuleBlock(`epochs[${i}]`, rec, errors);
		validateContextPlaceholders(`epochs[${i}].context`, String(b.context || ""), errors, "epoch");
		epochs.push({ ...b, period: normalizedPeriod, context: b.context || "" });
	}

	const resolved: BridgeResolvedSettings = {
		sharedContext,
		...rootBlock,
		maxRelatedChars,
		maxOutputWords: maxOutputWords > 0 ? maxOutputWords : undefined,
		reduce,
		records,
		epochs
	};

	const stored: BridgeOptionsState = {
		settingsYaml: userYaml
	};

	return {
		valid: errors.length === 0,
		errors,
		warnings,
		formattedUserYaml: userYaml ? asYamlString(userObj) : "",
		formattedMergedYaml: asYamlString(merged),
		resolved,
		stored
	};
}

export function sanitizeBridgeOptions(input: any): BridgeOptionsState {
	const raw = input && typeof input === "object" ? input : {};
	const settingsYaml = typeof raw.settingsYaml === "string" ? raw.settingsYaml : "";
	const checked = validateBridgeOptionsYaml(settingsYaml);
	if (checked.valid) return checked.stored;
	return validateBridgeOptionsYaml("").stored;
}
