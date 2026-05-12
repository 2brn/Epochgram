import { SUMMARY_SEPARATOR_SYMBOL } from "../epoch-canvas-constants";

export function parseFontPx(font: string): number {
	const m = String(font || "").match(/(\d+(?:\.\d+)?)px/);
	const v = m ? parseFloat(m[1]!) : Number.NaN;
	return Number.isFinite(v) ? v : 12;
}

export function measureVerticalMetrics(
	ctx: CanvasRenderingContext2D,
	font: string
): { ascent: number; descent: number } {
	try {
		ctx.save();
		ctx.font = font;
		const m = ctx.measureText("Hg");
		ctx.restore();
		const a = (m as any).actualBoundingBoxAscent;
		const d = (m as any).actualBoundingBoxDescent;
		const ascent = typeof a === "number" && Number.isFinite(a) && a > 0 ? a : 0;
		const descent = typeof d === "number" && Number.isFinite(d) && d >= 0 ? d : 0;
		if (ascent > 0) {
			return { ascent, descent: Math.max(0, descent) };
		}
	} catch {
		try {
			ctx.restore();
		} catch {
			// ignore
		}
	}
	const px = parseFontPx(font);
	return {
		ascent: Math.max(8, Math.round(px * 0.8)),
		descent: Math.max(2, Math.round(px * 0.2))
	};
}

export function wrapText(
	ctx: CanvasRenderingContext2D,
	text: string,
	maxWidth: number
): string[] {
	const raw = String(text || "").trim();
	if (!raw) return [""];
	if (maxWidth <= 0) return [""];

	const lines: string[] = [];
	const pushLine = (line: string) => lines.push(String(line ?? "").trimEnd());
	const pushWordAsSegments = (word: string) => {
		let cursor = 0;
		while (cursor < word.length) {
			let low = cursor + 1;
			let high = word.length;
			while (low < high) {
				const mid = Math.ceil((low + high) / 2);
				const candidate = word.slice(cursor, mid);
				if (ctx.measureText(candidate).width <= maxWidth) low = mid;
				else high = mid - 1;
			}
			const next = Math.max(cursor + 1, low);
			pushLine(word.slice(cursor, next));
			cursor = next;
		}
	};

	const paragraphs = raw.split(/\r?\n+/g);
	for (const pRaw of paragraphs) {
		const p = String(pRaw || "").trim();
		if (!p) continue;
		const words = p.split(/\s+/g).filter(Boolean);
		let cur = "";
		for (const w of words) {
			const next = cur ? `${cur} ${w}` : w;
			if (ctx.measureText(next).width <= maxWidth) {
				cur = next;
				continue;
			}
			if (cur) {
				pushLine(cur);
				cur = "";
			}
			if (ctx.measureText(w).width <= maxWidth) {
				cur = w;
				continue;
			}
			pushWordAsSegments(w);
		}
		if (cur) pushLine(cur);
	}

	const stripLonelyBulletLines = (value: string[]): string[] => {
		if (!Array.isArray(value) || value.length === 0) return [""];
		const sep = String(SUMMARY_SEPARATOR_SYMBOL ?? "").trim();
		const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const rxStart = sep ? new RegExp(`^\\s*${escapeRegex(sep)}\\s*`) : null;
		const rxEnd = sep ? new RegExp(`\\s*${escapeRegex(sep)}\\s*$`) : null;
		const out = value
			.map((l) => {
				const s = String(l ?? "");
				// If wrapping puts the separator at start/end-of-line, drop it.
				return (rxStart ? s.replace(rxStart, "") : s).replace(rxEnd ?? /$^/, "").trim();
			})
			.filter((l) => {
				const t = String(l ?? "").trim();
				if (!t) return false;
				return sep ? t !== sep : true;
			});
		return out.length > 0 ? out : [String(value[0] ?? "").trimEnd()];
	};

	const out = lines.length > 0 ? lines : [raw];
	return stripLonelyBulletLines(out);
}

export function wrapTextWithFirstLineWidth(
	ctx: CanvasRenderingContext2D,
	text: string,
	firstLineWidth: number,
	otherLinesWidth: number
): string[] {
	const raw = String(text || "").trim();
	if (!raw) return [""];
	if (otherLinesWidth <= 0) return [""];
	const firstW = firstLineWidth > 0 ? firstLineWidth : otherLinesWidth;

	const lines: string[] = [];
	const pushLine = (line: string) => lines.push(String(line ?? "").trimEnd());
	const widthForNextLine = () => (lines.length === 0 ? firstW : otherLinesWidth);
	const pushWordAsSegments = (word: string) => {
		let cursor = 0;
		while (cursor < word.length) {
			const maxWidth = widthForNextLine();
			let low = cursor + 1;
			let high = word.length;
			while (low < high) {
				const mid = Math.ceil((low + high) / 2);
				const candidate = word.slice(cursor, mid);
				if (ctx.measureText(candidate).width <= maxWidth) low = mid;
				else high = mid - 1;
			}
			const next = Math.max(cursor + 1, low);
			pushLine(word.slice(cursor, next));
			cursor = next;
		}
	};

	const paragraphs = raw.split(/\r?\n+/g);
	for (const pRaw of paragraphs) {
		const p = String(pRaw || "").trim();
		if (!p) continue;
		const words = p.split(/\s+/g).filter(Boolean);
		let cur = "";
		for (const w of words) {
			const maxWidth = widthForNextLine();
			const next = cur ? `${cur} ${w}` : w;
			if (ctx.measureText(next).width <= maxWidth) {
				cur = next;
				continue;
			}
			if (cur) {
				pushLine(cur);
				cur = "";
			}
			const maxWidth2 = widthForNextLine();
			if (ctx.measureText(w).width <= maxWidth2) {
				cur = w;
				continue;
			}
			pushWordAsSegments(w);
		}
		if (cur) pushLine(cur);
	}

	const stripLonelyBulletLines = (value: string[]): string[] => {
		if (!Array.isArray(value) || value.length === 0) return [""];
		const sep = String(SUMMARY_SEPARATOR_SYMBOL ?? "").trim();
		const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const rxStart = sep ? new RegExp(`^\\s*${escapeRegex(sep)}\\s*`) : null;
		const rxEnd = sep ? new RegExp(`\\s*${escapeRegex(sep)}\\s*$`) : null;
		const out = value
			.map((l) => {
				const s = String(l ?? "");
				return (rxStart ? s.replace(rxStart, "") : s).replace(rxEnd ?? /$^/, "").trim();
			})
			.filter((l) => {
				const t = String(l ?? "").trim();
				if (!t) return false;
				return sep ? t !== sep : true;
			});
		return out.length > 0 ? out : [String(value[0] ?? "").trimEnd()];
	};

	const out = lines.length > 0 ? lines : [raw];
	return stripLonelyBulletLines(out);
}

export function wrapTextGreedyWithFirstLineWidth(
	ctx: CanvasRenderingContext2D,
	text: string,
	firstLineWidth: number,
	otherLinesWidth: number
): string[] {
	const raw = String(text || "").trim();
	if (!raw) return [""];
	if (otherLinesWidth <= 0) return [""];
	const firstW = firstLineWidth > 0 ? firstLineWidth : otherLinesWidth;

	const lines: string[] = [];
	const pushLine = (line: string) => lines.push(String(line ?? "").trimEnd());
	const widthForNextLine = () => (lines.length === 0 ? firstW : otherLinesWidth);

	const isFilenameish = (word: string): boolean => {
		const w = String(word || "");
		if (!w) return false;
		if (/\.[a-z0-9]{2,6}$/i.test(w)) return true;
		if (/\d/.test(w) && /[._-]/.test(w)) return true;
		return false;
	};

	const isFilenameishText = (value: string): boolean => {
		const t = String(value || "").trim();
		if (!t) return false;
		if (/\.(md|png|jpe?g|gif|webp|svg|pdf|mp4|mov|mp3|wav)$/i.test(t)) return true;
		if (/\bPasted image\b/i.test(t) && /\d{6,}/.test(t) && /\.[a-z0-9]{2,6}$/i.test(t)) return true;
		if (/\d{6,}/.test(t) && /[._-]/.test(t)) return true;
		return false;
	};

	const filenameishOverall = isFilenameishText(raw);

	const maxPrefixLenToFit = (prefix: string, maxWidth: number): number => {
		if (!prefix) return 0;
		let low = 0;
		let high = prefix.length;
		while (low < high) {
			const mid = Math.ceil((low + high) / 2);
			const candidate = prefix.slice(0, mid);
			if (ctx.measureText(candidate).width <= maxWidth) low = mid;
			else high = mid - 1;
		}
		return Math.max(0, Math.min(prefix.length, low));
	};

	const pushWordAsSegments = (word: string) => {
		let cursor = 0;
		while (cursor < word.length) {
			const maxWidth = widthForNextLine();
			let low = cursor + 1;
			let high = word.length;
			while (low < high) {
				const mid = Math.ceil((low + high) / 2);
				const candidate = word.slice(cursor, mid);
				if (ctx.measureText(candidate).width <= maxWidth) low = mid;
				else high = mid - 1;
			}
			const next = Math.max(cursor + 1, low);
			pushLine(word.slice(cursor, next));
			cursor = next;
		}
	};

	const paragraphs = raw.split(/\r?\n+/g);
	for (const pRaw of paragraphs) {
		const p = String(pRaw || "").trim();
		if (!p) continue;
		const words = p.split(/\s+/g).filter(Boolean);
		let cur = "";
		for (const rawWord of words) {
			let w = String(rawWord || "");
			while (w) {
				const maxWidth = widthForNextLine();
				const next = cur ? `${cur} ${w}` : w;
				if (ctx.measureText(next).width <= maxWidth) {
					cur = next;
					break;
				}

				if (cur) {
					// Greedy fill: if the next word doesn't fit but looks filename-ish, pack as many
					// characters as possible into the remaining width instead of moving the whole word.
					// Also apply this to filename-ish full strings (e.g. "Pasted image 2025....png") so
					// we don't waste large empty space on the right.
					if (filenameishOverall || isFilenameish(w)) {
						const baseWithSpace = `${cur} `;
						const baseWidth = ctx.measureText(baseWithSpace).width;
						const remaining = maxWidth - baseWidth;
						if (remaining > 0) {
							const take = maxPrefixLenToFit(w, remaining);
							const minTake = filenameishOverall ? 1 : 4;
							if (take >= minTake && take < w.length) {
								pushLine(baseWithSpace + w.slice(0, take));
								w = w.slice(take);
								cur = "";
								continue;
							}
						}
					}

					pushLine(cur);
					cur = "";
					continue;
				}

				// cur is empty and the word still doesn't fit: split into segments.
				if (ctx.measureText(w).width <= maxWidth) {
					cur = w;
					break;
				}
				pushWordAsSegments(w);
				w = "";
			}
		}
		if (cur) pushLine(cur);
	}

	const stripLonelyBulletLines = (value: string[]): string[] => {
		if (!Array.isArray(value) || value.length === 0) return [""];
		const sep = String(SUMMARY_SEPARATOR_SYMBOL ?? "").trim();
		const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const rxStart = sep ? new RegExp(`^\\s*${escapeRegex(sep)}\\s*`) : null;
		const rxEnd = sep ? new RegExp(`\\s*${escapeRegex(sep)}\\s*$`) : null;
		const out = value
			.map((l) => {
				const s = String(l ?? "");
				return (rxStart ? s.replace(rxStart, "") : s).replace(rxEnd ?? /$^/, "").trim();
			})
			.filter((l) => {
				const t = String(l ?? "").trim();
				if (!t) return false;
				return sep ? t !== sep : true;
			});
		return out.length > 0 ? out : [String(value[0] ?? "").trimEnd()];
	};

	const out = lines.length > 0 ? lines : [raw];
	return stripLonelyBulletLines(out);
}
