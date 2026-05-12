export function dot(a: number[], b: number[]): number {
	const dim = Math.min(a.length, b.length);
	let s = 0;
	for (let i = 0; i < dim; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
	return s;
}
