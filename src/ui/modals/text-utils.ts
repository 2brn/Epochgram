function splitWords(value: string): string[] {
	const trimmed = (value ?? "").trim();
	if (!trimmed) return [];
	return trimmed.split(/\s+/g).filter(Boolean);
}

export function truncateToWords(value: string, maxWords: number): string {
	if (!value) return "";
	const words = splitWords(value);
	if (words.length <= maxWords) return value;
	return words.slice(0, maxWords).join(" ");
}

export function truncateToChars(value: string, maxChars: number): string {
	if (!value) return "";
	const limit = Math.max(1, Math.floor(maxChars || 0));
	if (!Number.isFinite(limit) || limit <= 0) return value;
	return value.length > limit ? value.slice(0, limit) : value;
}
