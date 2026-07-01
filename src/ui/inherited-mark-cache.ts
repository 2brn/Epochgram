function normalizeNonEpochPath(value: unknown): string {
	const p = typeof value === "string" ? String(value || "").trim() : "";
	if (!p || p.startsWith("epoch://")) return "";
	return p;
}

type InheritedMarkCachePluginLike = {
	__epochInheritedMarkIndexByPath?: Map<string, unknown>;
	__epochInheritedMarkSourceByPath?: Map<string, unknown>;
	__epochInheritedMarkReasonByPath?: Map<string, unknown>;
};

export function dropCachedInheritedMarkForPath(plugin: InheritedMarkCachePluginLike, path: string): void {
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
