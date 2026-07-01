export function normalizeSnapshotValue(text: string | null | undefined): string | null {
	if (typeof text !== "string") return null;
	let normalized = text;
	// Strip UTF-8 BOM if present (can appear after cross-device sync/encoding changes).
	if (normalized.charCodeAt(0) === 0xfeff) {
		normalized = normalized.slice(1);
	}
	// Normalize all common newline representations to \n.
	normalized = normalized
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n")
		.replace(/\u2028|\u2029/g, "\n");
	// Normalize Unicode to reduce cross-platform differences (e.g. NFC vs NFD).
	try {
		if (typeof normalized.normalize === "function") {
			normalized = normalized.normalize("NFC");
		}
	} catch {
		// ignore
	}
	return normalized;
}

export function snapshotsEqual(
	a: string | null | undefined,
	b: string | null | undefined
): boolean {
	const normalizedA = normalizeSnapshotValue(a);
	const normalizedB = normalizeSnapshotValue(b);
	if (normalizedA === null && normalizedB === null) return true;
	return (normalizedA ?? "") === (normalizedB ?? "");
}
