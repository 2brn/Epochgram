export function hashText(text: string): string {
	let hash = 0;
	for (let i = 0; i < text.length; i++) {
		hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
	}
	return hash.toString(16);
}
