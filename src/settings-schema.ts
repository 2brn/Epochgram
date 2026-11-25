import { DEFAULT_SETTINGS, type EpochSettings } from "./settings-model";

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Read only the current schema. Unknown fields are ignored, never translated or migrated. */
export function readCurrentSettings(value: unknown): EpochSettings {
	const raw = record(value);
	const result = structuredClone(DEFAULT_SETTINGS);
	const out = result as unknown as Record<string, unknown>;
	for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof EpochSettings>) {
		if (key === "timelineFilters" || !Object.prototype.hasOwnProperty.call(raw, key)) continue;
		const incoming = raw[key], fallback = DEFAULT_SETTINGS[key];
		if (Array.isArray(fallback)) {
			if (Array.isArray(incoming)) out[key] = incoming.filter((item): item is string => typeof item === "string");
		} else if (typeof incoming === typeof fallback && (typeof incoming !== "number" || Number.isFinite(incoming))) out[key] = incoming;
	}
	const filters = record(raw.timelineFilters);
	result.timelineFilters = {
		showAttachments: typeof filters.showAttachments === "boolean" ? filters.showAttachments : DEFAULT_SETTINGS.timelineFilters!.showAttachments,
		showParsed: typeof filters.showParsed === "boolean" ? filters.showParsed : DEFAULT_SETTINGS.timelineFilters!.showParsed
	};
	if (!["manual", "startup", "1m", "5m", "15m", "1h", "6h", "24h"].includes(result.calendarSyncPeriod ?? "")) result.calendarSyncPeriod = DEFAULT_SETTINGS.calendarSyncPeriod;
	return result;
}

export function currentSettingsSignature(data: unknown): string | null {
	const raw = record(data);
	return raw.settings == null ? null : JSON.stringify({ settings: readCurrentSettings(raw.settings) });
}
