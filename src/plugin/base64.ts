const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

type BufferLike = {
	toString(encoding: "base64"): string;
	buffer: ArrayBufferLike;
	byteOffset: number;
	byteLength: number;
};

type BufferCtorLike = {
	from(input: Uint8Array | string, encoding?: "base64"): BufferLike;
};

type WindowWithBuffer = Window & {
	Buffer?: BufferCtorLike;
};

function getBufferCtor(): BufferCtorLike | null {
	const maybe = (window as WindowWithBuffer).Buffer;
	return typeof maybe === "function" ? maybe : null;
}

export function encodeBase64(bytes: Uint8Array): string {
	const BufferCtor = getBufferCtor();
	if (BufferCtor) {
		return BufferCtor.from(bytes).toString("base64");
	}
	let out = "";
	for (let i = 0; i < bytes.length; i += 3) {
		const a = bytes[i] ?? 0;
		const b = bytes[i + 1] ?? 0;
		const c = bytes[i + 2] ?? 0;
		const triple = (a << 16) | (b << 8) | c;
		out += BASE64_ALPHABET[(triple >>> 18) & 0x3f];
		out += BASE64_ALPHABET[(triple >>> 12) & 0x3f];
		out += i + 1 < bytes.length ? BASE64_ALPHABET[(triple >>> 6) & 0x3f] : "=";
		out += i + 2 < bytes.length ? BASE64_ALPHABET[triple & 0x3f] : "=";
	}
	return out;
}

export function decodeBase64(value: string): Uint8Array {
	const input = String(value ?? "").replace(/\s+/g, "");
	const BufferCtor = getBufferCtor();
	if (BufferCtor) {
		const buf = BufferCtor.from(input, "base64");
		return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
	}
	if (!input) return new Uint8Array(0);
	if (input.length % 4 !== 0) {
		throw new Error("Invalid base64 length");
	}
	const map = new Int16Array(128).fill(-1);
	for (let i = 0; i < BASE64_ALPHABET.length; i++) {
		map[BASE64_ALPHABET.charCodeAt(i)] = i;
	}
	const padding = input.endsWith("==") ? 2 : input.endsWith("=") ? 1 : 0;
	const outLen = (input.length / 4) * 3 - padding;
	const out = new Uint8Array(outLen);
	let outIdx = 0;
	for (let i = 0; i < input.length; i += 4) {
		const c1 = input.charCodeAt(i);
		const c2 = input.charCodeAt(i + 1);
		const c3 = input.charCodeAt(i + 2);
		const c4 = input.charCodeAt(i + 3);
		const v1 = c1 < 128 ? map[c1] : -1;
		const v2 = c2 < 128 ? map[c2] : -1;
		const v3 = c3 === 61 ? 0 : c3 < 128 ? map[c3] : -1;
		const v4 = c4 === 61 ? 0 : c4 < 128 ? map[c4] : -1;
		if (v1 < 0 || v2 < 0 || (c3 !== 61 && v3 < 0) || (c4 !== 61 && v4 < 0)) {
			throw new Error("Invalid base64 content");
		}
		const triple = (v1 << 18) | (v2 << 12) | (v3 << 6) | v4;
		if (outIdx < outLen) out[outIdx++] = (triple >>> 16) & 0xff;
		if (outIdx < outLen) out[outIdx++] = (triple >>> 8) & 0xff;
		if (outIdx < outLen) out[outIdx++] = triple & 0xff;
	}
	return out;
}