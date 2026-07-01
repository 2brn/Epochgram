import * as YAML from "yaml";
import defaultBridgeSettingsYaml from "epochgram-bridge-default-settings-yaml";

type AiBridgeServerState = {
	token: string;
	port?: number;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as UnknownRecord;
}

export function sanitizeBridgeServerState(input: unknown): AiBridgeServerState | null {
	const record = asRecord(input);
	if (!record) return null;
	const token = typeof record.token === "string" ? record.token : "";
	if (!token || token.length < 16 || token.length > 128) return null;
	const portRaw = record.port;
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
	"4days": "4days",
	week: "week",
	"2weeks": "2weeks",
	month: "month",
	"3months": "3months",
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

function normalizePositiveInteger(raw: unknown): number | null {
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

function checkUnknownKeys(name: string, obj: UnknownRecord, allowed: Set<string>, errors: string[]) {
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
	raw: UnknownRecord,
	key: keyof BridgeTuningFields,
	errors: string[],
	out: UnknownRecord | BridgeSettingsOverride
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
	(out as UnknownRecord)[key] = normalized;
}

function applyOptionalPositiveIntegerField(
	name: string,
	raw: UnknownRecord,
	key: keyof BridgeTuningFields,
	errors: string[],
	out: UnknownRecord | BridgeSettingsOverride
) {
	if (!hasOwn(raw, key)) return;
	if (isEmptyYamlScalar(raw[key])) return;
	const normalized = normalizePositiveInteger(raw[key]);
	if (normalized == null) {
		errors.push(`${name}.${key} must be a positive integer`);
		return;
	}
	(out as UnknownRecord)[key] = normalized;
}

function readPositiveIntegerOrDefault(rawValue: unknown, defaultValue: unknown): number {
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

function replaceNullScalarsWithEmptyString(value: unknown): unknown {
	if (value === null) return "";
	if (Array.isArray(value)) {
		const result: unknown[] = value.map((item) => replaceNullScalarsWithEmptyString(item));
		return result;
	}
	if (!value || typeof value !== "object") return value;
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(value)) {
		out[k] = replaceNullScalarsWithEmptyString(v);
	}
	return out;
}

function parseYamlObject(raw: string): UnknownRecord {
	const doc = replaceNullScalarsWithEmptyString(YAML.parse(String(raw || "")));
	return asRecord(doc) ?? {};
}

function deepMerge(base: unknown, override: unknown): unknown {
	if (Array.isArray(base) || Array.isArray(override)) {
		return override == null ? base : override;
	}
	if (!base || typeof base !== "object") return override == null ? base : override;
	if (!override || typeof override !== "object") return override == null ? base : override;
	const baseRecord = base as UnknownRecord;
	const overrideRecord = override as UnknownRecord;
	const out: UnknownRecord = { ...baseRecord };
	for (const key of Object.keys(overrideRecord)) {
		out[key] = deepMerge(baseRecord[key], overrideRecord[key]);
	}
	return out;
}

function asYamlString(value: unknown): string {
	return YAML.stringify(value, {
		lineWidth: 0,
		sortMapEntries: false,
		aliasDuplicateObjects: false,
		simpleKeys: false
	}).trim() + "\n";
}

function canonicalizeLanguageTag(raw: unknown): string | null {
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

function normalizeSupportedLanguageCode(raw: unknown): string | null {
	const canonical = canonicalizeLanguageTag(raw);
	if (!canonical) return null;
	const base = String(canonical).toLowerCase().split(/[-_]/)[0] || "";
	if (!base) return null;
	return SUPPORTED_LANGUAGES.has(base) ? base : null;
}

function normalizeLang(raw: unknown, fallback: BridgeLanguage = "en"): BridgeLanguage {
	return normalizeSupportedLanguageCode(raw) || normalizeSupportedLanguageCode(fallback) || "en";
}

function normalizeLangList(raw: unknown, fallback: BridgeLanguage[]): BridgeLanguage[] {
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

function normalizeType(raw: unknown): BridgeKind {
	const v = typeof raw === "string" ? raw : "";
	return TYPE_VALUES.has(v) ? (v as BridgeKind) : "headline";
}

function normalizeFormat(raw: unknown): BridgeFormat {
	const v = typeof raw === "string" ? raw : "";
	return FORMAT_VALUES.has(v) ? (v as BridgeFormat) : "plain-text";
}

function normalizeLength(raw: unknown): BridgeLength {
	const v = typeof raw === "string" ? raw : "";
	return LENGTH_VALUES.has(v) ? (v as BridgeLength) : "short";
}

function normalizePreference(raw: unknown): BridgePreference {
	const v = typeof raw === "string" ? raw : "";
	return PREFERENCE_VALUES.has(v) ? (v as BridgePreference) : "auto";
}

function normalizePeriod(raw: unknown): string {
	const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
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
		const idx = PERIOD_ORDER.indexOf(v as (typeof PERIOD_ORDER)[number]);
		return idx >= 0 ? [idx, idx] : null;
	}
	const [a, b] = v.split("-") as [(typeof PERIOD_ORDER)[number], (typeof PERIOD_ORDER)[number]];
	const i = PERIOD_ORDER.indexOf(a);
	const j = PERIOD_ORDER.indexOf(b);
	if (i < 0 || j < 0 || i > j) return null;
	return [i, j];
}

function hasOwn(obj: unknown, key: string): boolean {
	return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function isEmptyYamlScalar(value: unknown): boolean {
	if (value == null) return true;
	if (typeof value === "string" && !value.trim()) return true;
	return false;
}

function validateExplicitEmptyFields(
	name: string,
	raw: unknown,
	errors: string[],
	opts?: { allowContext?: boolean; numericKeys?: Array<keyof BridgeTuningFields> }
) {
	const allowContext = opts?.allowContext === true;
	const numericKeys = Array.isArray(opts?.numericKeys) ? opts.numericKeys : [];
	const record = asRecord(raw);
	if (!record) return;
	if (hasOwn(record, "type") && isEmptyYamlScalar(record.type)) {
		errors.push(`${name}.type cannot be empty`);
	}
	if (hasOwn(record, "format") && isEmptyYamlScalar(record.format)) {
		errors.push(`${name}.format cannot be empty`);
	}
	if (hasOwn(record, "length") && isEmptyYamlScalar(record.length)) {
		errors.push(`${name}.length cannot be empty`);
	}
	if (hasOwn(record, "preference") && isEmptyYamlScalar(record.preference)) {
		errors.push(`${name}.preference cannot be empty`);
	}
	if (hasOwn(record, "outputLanguage") && isEmptyYamlScalar(record.outputLanguage)) {
		errors.push(`${name}.outputLanguage cannot be empty`);
	}
	if (allowContext && hasOwn(record, "context") && isEmptyYamlScalar(record.context)) {
		errors.push(`${name}.context cannot be empty`);
	}
	for (const key of numericKeys) {
		if (hasOwn(record, key) && isEmptyYamlScalar(record[key])) {
			errors.push(`${name}.${key} cannot be empty`);
		}
	}
}

function validateBlock(name: string, block: unknown, errors: string[], opts?: { allowContext?: boolean; defaultMissing?: boolean }): BridgeSettingsBlock | BridgeSettingsOverride {
	const allowContext = opts?.allowContext === true;
	const defaultMissing = opts?.defaultMissing === true;
	const raw = asRecord(block) ?? {};
	const out: BridgeSettingsOverride = {};
	if (defaultMissing || raw.type != null) out.type = normalizeType(raw.type);
	if (defaultMissing || raw.format != null) out.format = normalizeFormat(raw.format);
	if (defaultMissing || raw.length != null) out.length = normalizeLength(raw.length);
	if (defaultMissing || raw.preference != null) out.preference = normalizePreference(raw.preference);
	if (defaultMissing || raw.expectedInputLanguages != null) out.expectedInputLanguages = normalizeLangList(raw.expectedInputLanguages, ["en", "ja", "es"]);
	if (defaultMissing || raw.outputLanguage != null) out.outputLanguage = normalizeLang(raw.outputLanguage);
	if (defaultMissing || raw.expectedContextLanguages != null) out.expectedContextLanguages = normalizeLangList(raw.expectedContextLanguages, ["en"]);
	if (allowContext && typeof raw.context === "string") out.context = raw.context;
	applyOptionalPositiveIntegerField(name, raw, "maxOutputWords", errors, out);

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

	if (raw.type != null && (typeof raw.type !== "string" || !TYPE_VALUES.has(raw.type))) errors.push(`${name}.type must be one of: key-points, tldr, teaser, headline`);
	if (raw.format != null && (typeof raw.format !== "string" || !FORMAT_VALUES.has(raw.format))) errors.push(`${name}.format must be one of: markdown, plain-text`);
	if (raw.length != null && (typeof raw.length !== "string" || !LENGTH_VALUES.has(raw.length))) errors.push(`${name}.length must be one of: short, medium, long`);
	if (raw.preference != null && (typeof raw.preference !== "string" || !PREFERENCE_VALUES.has(raw.preference))) errors.push(`${name}.preference must be one of: auto, speed, capability`);
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
	return out;
}

function validateReduceBlock(name: string, block: unknown, errors: string[]): BridgeSettingsOverride {
	const out = validateBlock(name, block, errors, { allowContext: true }) as BridgeSettingsOverride;
	const raw = asRecord(block) ?? {};
	applyPositiveIntegerField(name, raw, "maxDepth", errors, out);
	applyPositiveIntegerField(name, raw, "maxChunkChars", errors, out);
	return out;
}

function validateRecordsBlock(name: string, block: unknown, errors: string[]): BridgeSettingsOverride {
	const out = validateBlock(name, block, errors, { allowContext: true }) as BridgeSettingsOverride;
	const raw = asRecord(block) ?? {};
	applyPositiveIntegerField(name, raw, "maxInputChars", errors, out);
	return out;
}

function validateEpochRuleBlock(name: string, block: unknown, errors: string[]): BridgeSettingsOverride {
	const out = validateBlock(name, block, errors, { allowContext: true }) as BridgeSettingsOverride;
	const raw = asRecord(block) ?? {};
	applyPositiveIntegerField(name, raw, "maxFileChars", errors, out);
	return out;
}

export function validateBridgeOptionsYaml(settingsYamlRaw: string): BridgeOptionsValidation {
	const errors: string[] = [];
	const warnings: string[] = [];
	const userYaml = String(settingsYamlRaw || "").trim();
	let userObj: UnknownRecord = {};
	let defaultObj: UnknownRecord = {};

	try {
		defaultObj = parseYamlObject(defaultBridgeSettingsYaml);
	} catch (err: unknown) {
		errors.push(`Default settings YAML is invalid: ${err instanceof Error ? err.message : String(err)}`);
	}

	if (userYaml) {
		try {
			userObj = parseYamlObject(userYaml);
		} catch (err: unknown) {
			errors.push(`settings YAML parse error: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	if (Object.keys(userObj).length > 0) {
		checkUnknownKeys("root", userObj, ROOT_KEYS, errors);
		validateExplicitEmptyFields("root", userObj, errors, { numericKeys: ["maxRelatedChars"] });
		if (asRecord(userObj.reduce)) {
			checkUnknownKeys("reduce", asRecord(userObj.reduce) ?? {}, REDUCE_KEYS, errors);
			validateExplicitEmptyFields("reduce", userObj.reduce, errors, { allowContext: true, numericKeys: ["maxDepth", "maxChunkChars"] });
		}
		if (asRecord(userObj.records)) {
			checkUnknownKeys("records", asRecord(userObj.records) ?? {}, RECORDS_KEYS, errors);
			validateExplicitEmptyFields("records", userObj.records, errors, { allowContext: true, numericKeys: ["maxInputChars"] });
		}
		if (Array.isArray(userObj.epochs)) {
			const userEpochs = userObj.epochs as unknown[];
			for (let i = 0; i < userEpochs.length; i++) {
				const ep = userEpochs[i];
				if (asRecord(ep)) {
					checkUnknownKeys(`epochs[${i}]`, asRecord(ep) ?? {}, EPOCH_KEYS, errors);
					validateExplicitEmptyFields(`epochs[${i}]`, ep, errors, { allowContext: true, numericKeys: ["maxFileChars"] });
				}
			}
		}
	}

	const merged = (deepMerge(defaultObj, userObj) as UnknownRecord) ?? {};
	const rootBlock = validateBlock("root", merged, errors, { defaultMissing: true }) as BridgeSettingsBlock;
	const sharedContext = typeof merged.sharedContext === "string" ? merged.sharedContext : "";
	if (hasOwn(merged, "maxRelatedChars")) {
		applyPositiveIntegerField("root", merged, "maxRelatedChars", errors, merged);
	}
	const maxRelatedChars = readPositiveIntegerOrDefault(merged.maxRelatedChars, defaultObj.maxRelatedChars);
	const maxOutputWords = readPositiveIntegerOrDefault(merged.maxOutputWords, defaultObj.maxOutputWords);
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
		const rec = asRecord(epochsRaw[i]) ?? {};
		const normalizedPeriod = normalizePeriod(rec.period);
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

export function sanitizeBridgeOptions(input: unknown): BridgeOptionsState {
	const raw = asRecord(input) ?? {};
	const settingsYaml = typeof raw.settingsYaml === "string" ? raw.settingsYaml : "";
	const checked = validateBridgeOptionsYaml(settingsYaml);
	if (checked.valid) return checked.stored;
	return validateBridgeOptionsYaml("").stored;
}
