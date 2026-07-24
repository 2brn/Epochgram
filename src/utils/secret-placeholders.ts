function toSecretCandidateIds(rawName: string): string[] {
	const name = String(rawName || "").trim();
	if (!name) return [];
	const out: string[] = [];
	const push = (value: string) => {
		const v = String(value || "").trim();
		if (!v) return;
		if (!out.includes(v)) out.push(v);
	};
	push(name);
	push(name.toLowerCase());
	push(name.toLowerCase().replace(/_/g, "-"));
	return out;
}

export function resolveSecretPlaceholders(raw: string, lookup: (id: string) => string | null, errors?: string[]): string {
	const src = String(raw || "");
	if (!src) return src;
	return src.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (fullMatch, nameRaw: string) => {
		const ids = toSecretCandidateIds(nameRaw);
		if (ids.length === 0) {
			errors?.push(`secret placeholder '{{${String(nameRaw)}}}' is invalid`);
			return fullMatch;
		}
		for (const id of ids) {
			const value = lookup(id);
			if (typeof value === "string" && value.trim().length > 0) return value;
		}
		errors?.push(`secret placeholder '{{${String(nameRaw)}}}' not found in Secret Storage (Settings > Keychain)`);
		return fullMatch;
	});
}