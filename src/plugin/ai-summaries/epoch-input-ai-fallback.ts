type EpochInputAiSummaryError = {
	inputHash: string;
	error: string;
	at: number;
};

type EpochInputAiSummaryEntry = {
	file?: string;
	date?: string;
	source?: string;
	blockStart?: number;
	blockEnd?: number;
};

type EpochInputAiSummaryState = {
	__epochInputAiSummaryErrors?: Map<string, EpochInputAiSummaryError>;
};

function getMap(plugin: unknown): Map<string, EpochInputAiSummaryError> {
	const state = plugin as EpochInputAiSummaryState;
	if (!state.__epochInputAiSummaryErrors) {
		state.__epochInputAiSummaryErrors = new Map<string, EpochInputAiSummaryError>();
	}
	return state.__epochInputAiSummaryErrors;
}

export function epochInputKeyForEntry(entry: EpochInputAiSummaryEntry): string {
	try {
		const file = String(entry?.file ?? "");
		const date = String(entry?.date ?? "");
		const source = String(entry?.source ?? "");
		const blockStart = Number(entry?.blockStart ?? 0);
		const blockEnd = Number(entry?.blockEnd ?? 0);
		return `${file}|${date}|${source}|${blockStart}|${blockEnd}`;
	} catch {
		return "";
	}
}

export function hasEpochInputAiSummaryError(plugin: unknown, entry: EpochInputAiSummaryEntry): boolean {
	const key = epochInputKeyForEntry(entry);
	if (!key) return false;
	const rec = getMap(plugin).get(key);
	if (!rec) return false;
	// Avoid sticky behavior across long sessions.
	// If we still care after this window, another error will refresh it.
	const MAX_AGE_MS = 30 * 60 * 1000;
	if (Date.now() - rec.at > MAX_AGE_MS) {
		getMap(plugin).delete(key);
		return false;
	}
	return true;
}

export function markEpochInputAiSummaryError(
	plugin: unknown,
	entries: EpochInputAiSummaryEntry[],
	inputHash: string,
	error: string
): void {
	const map = getMap(plugin);
	const err = String(error ?? "").trim() || "(unknown error)";
	const h = String(inputHash ?? "").trim();
	const at = Date.now();
	for (const e of Array.isArray(entries) ? entries : []) {
		const key = epochInputKeyForEntry(e);
		if (!key) continue;
		map.set(key, { inputHash: h, error: err, at });
	}
}

export function clearEpochInputAiSummaryError(plugin: unknown, entries: EpochInputAiSummaryEntry[]): void {
	const map = getMap(plugin);
	for (const e of Array.isArray(entries) ? entries : []) {
		const key = epochInputKeyForEntry(e);
		if (!key) continue;
		map.delete(key);
	}
}
