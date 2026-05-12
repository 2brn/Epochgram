export function normalizeVector(v: number[]): number[] {
	let sumSq = 0;
	for (let i = 0; i < v.length; i++) {
		const x = v[i] ?? 0;
		sumSq += x * x;
	}
	const norm = Math.sqrt(sumSq) || 1;
	for (let i = 0; i < v.length; i++) {
		v[i] = (v[i] ?? 0) / norm;
	}
	return v;
}

export function meanPool(vectors: number[][]): number[] {
	if (vectors.length === 0) return [];
	if (vectors.length === 1) return normalizeVector(vectors[0].slice());
	const dim = vectors[0].length;
	const acc = new Array(dim).fill(0);
	let count = 0;
	for (const vec of vectors) {
		if (!vec || vec.length !== dim) continue;
		for (let i = 0; i < dim; i++) {
			acc[i] += vec[i] ?? 0;
		}
		count++;
	}
	if (count <= 1) return normalizeVector(acc);
	for (let i = 0; i < dim; i++) acc[i] /= count;
	return normalizeVector(acc);
}

export function coerceVector(raw: any): number[] {
	const data = raw?.data ?? raw;
	if (Array.isArray(data)) return normalizeVector(data.slice());
	if (data && (data instanceof Float32Array || data instanceof Float64Array)) return normalizeVector(Array.from(data));
	if (data && typeof data.length === "number") return normalizeVector(Array.from(data as any));
	throw new Error("Unexpected vector output");
}
