export const PLUSN_PREFIX_RE = /^(\+[0-9]{1,5})[ \t]+/;

export function formatPlusNPrefix(hiddenCount: number): string {
	if (!Number.isFinite(hiddenCount)) return "";
	const n = Math.floor(hiddenCount);
	if (n <= 0) return "";
	return `+${n} `;
}

export function splitPlusNPrefix(value: string): { prefix: string; rest: string } | null {
	const s = String(value ?? "");
	const m = s.match(PLUSN_PREFIX_RE);
	if (!m) return null;
	const prefix = String(m[1] ?? "");
	const rest = s.slice(m[0].length);
	return { prefix, rest };
}
