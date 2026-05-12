function normalizeNonEpochPath(value: unknown): string {
	const p = typeof value === "string" ? String(value || "").trim() : "";
	if (!p || p.startsWith("epoch://")) return "";
	return p;
}

export function dropCachedInheritedMarkForPath(plugin: any, path: string): void {
	const p = normalizeNonEpochPath(path);
	if (!p) return;
	try {
		const m: unknown = plugin?.__epochInheritedMarkIndexByPath;
		if (m instanceof Map) m.delete(p);
	} catch {
		// ignore
	}
	try {
		const m: unknown = plugin?.__epochInheritedMarkSourceByPath;
		if (m instanceof Map) m.delete(p);
	} catch {
		// ignore
	}
	try {
		const m: unknown = plugin?.__epochInheritedMarkReasonByPath;
		if (m instanceof Map) m.delete(p);
	} catch {
		// ignore
	}
}
