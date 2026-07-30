export function getCalendarSyncDisplayValue(canCalendarSync: boolean, storedValue: string, pendingValue: string): string {
	if (!canCalendarSync) return "";
	const stored = String(storedValue ?? "").trim();
	const pending = String(pendingValue ?? "").trim();
	return pending || stored;
}

export function getCalendarSyncUrlRows(canCalendarSync: boolean, storedUrls: string[]): string[] {
	if (!canCalendarSync) return [""];
	const normalized = storedUrls.map((value) => String(value ?? "").trim()).filter(Boolean);
	return normalized.length > 0 ? [...normalized, ""] : [""];
}
