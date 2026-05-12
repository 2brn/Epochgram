import { SUMMARY_SEPARATOR_SYMBOL } from "../../epoch-canvas-constants";

function escapeRegExp(value: string): string {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripDanglingSummarySeparatorEllipsis(value: string): string {
	const s = String(value ?? "");
	if (!s) return s;
	const sep = String(SUMMARY_SEPARATOR_SYMBOL ?? "");
	if (!sep) return s;
	const re = new RegExp(`\\s*${escapeRegExp(sep)}\\s*(\\.{3}|…)\\s*$`);
	if (!re.test(s)) return s;
	return s.replace(re, "…");
}

export function ellipsizeToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
	const raw = String(text ?? "");
	const w = Number(maxWidth);
	if (!raw || !(w > 0)) return raw;
	if (ctx.measureText(raw).width <= w) return raw;
	const ell = "…";
	if (ctx.measureText(ell).width >= w) return "";
	let lo = 0;
	let hi = raw.length;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		const s = raw.slice(0, mid).trimEnd() + ell;
		if (ctx.measureText(s).width <= w) lo = mid;
		else hi = mid - 1;
	}
	return stripDanglingSummarySeparatorEllipsis(raw.slice(0, lo).trimEnd() + ell);
}

export function ellipsizeLineToRight(
	ctx: CanvasRenderingContext2D,
	line: string,
	startX: number,
	rightLimit: number
): string {
	const raw = String(line ?? "").trimEnd();
	const x = Number(startX);
	const r = Number(rightLimit);
	if (!Number.isFinite(x) || !Number.isFinite(r)) return raw;
	return ellipsizeToWidth(ctx, raw, Math.max(0, r - x));
}
