import {
	SUMMARY_ROW_HEIGHT,
	SUMMARY_ICON_BASE_SIZE,
	SUMMARY_ICON_MIN_SIZE,
	SUMMARY_ICON_MAX_SIZE,
	SUMMARY_ICON_GAP,
	SUMMARY_ICON_TEXT_GAP
} from "./epoch-canvas-constants";
import type { CanvasIconCache } from "./canvas-icon-cache";

interface SummaryIconMetrics {
	count: number;
	size: number;
	gap: number;
	textGap: number;
	iconsWidth: number;
	totalWidth: number;
}

export function getSummaryIconMetrics(count: number, rowHeight: number): SummaryIconMetrics {
	if (count <= 0) {
		return { count: 0, size: 0, gap: 0, textGap: 0, iconsWidth: 0, totalWidth: 0 };
	}
	const scale = rowHeight / SUMMARY_ROW_HEIGHT;
	const baseSize = Math.round(SUMMARY_ICON_BASE_SIZE * scale);
	const size = Math.max(SUMMARY_ICON_MIN_SIZE, Math.min(SUMMARY_ICON_MAX_SIZE, baseSize));
	const gap = Math.max(1, Math.round(SUMMARY_ICON_GAP * scale));
	const textGap = Math.max(2, Math.round(SUMMARY_ICON_TEXT_GAP * scale));
	const iconsWidth = count * size + (count - 1) * gap;
	return {
		count,
		size,
		gap,
		textGap,
		iconsWidth,
		totalWidth: iconsWidth + textGap
	};
}

export function drawSummaryIcons(
	ctx: CanvasRenderingContext2D,
	iconCache: CanvasIconCache,
	iconIds: string[],
	color: string,
	x: number,
	centerY: number,
	size: number,
	gap: number
): void {
	const y = centerY - 1;
	let cursor = x;
	for (let i = 0; i < iconIds.length; i++) {
		const iconId = iconIds[i];
		const cached = iconCache.get(iconId);
		if (cached && cached.paths.length > 0) {
			const viewBox = cached.viewBox;
			const baseSize = cached.maxDimension || Math.max(viewBox.width, viewBox.height) || 24;
			const scale = size / baseSize;
			ctx.save();
			try {
				ctx.translate(cursor + size / 2, y);
				ctx.scale(scale, scale);
				const translateX = cached.contentBounds
					? cached.contentBounds.x + cached.contentBounds.width / 2
					: viewBox.x + viewBox.width / 2;
				const translateY = cached.contentBounds
					? cached.contentBounds.y + cached.contentBounds.height / 2
					: viewBox.y + viewBox.height / 2;
				ctx.translate(-translateX, -translateY);
				ctx.strokeStyle = color;
				ctx.fillStyle = color;
				const prevCap = ctx.lineCap;
				const prevJoin = ctx.lineJoin;
				ctx.lineCap = "round";
				ctx.lineJoin = "round";
				const forceFillOnly = iconId === "tag";
				for (const segment of cached.paths) {
					if (forceFillOnly) {
						ctx.fill(segment.path);
						continue;
					}
					if (segment.hasFill) {
						ctx.fill(segment.path);
					}
					if (segment.hasStroke) {
						ctx.lineWidth = segment.strokeWidth;
						ctx.stroke(segment.path);
					}
				}
				ctx.lineCap = prevCap;
				ctx.lineJoin = prevJoin;
			} finally {
				ctx.restore();
			}
		} else {
			ctx.save();
			try {
				ctx.fillStyle = color;
				const radius = size * 0.35;
				ctx.beginPath();
				ctx.arc(cursor + size / 2, y, radius, 0, Math.PI * 2);
				ctx.fill();
			} finally {
				ctx.restore();
			}
		}
		cursor += size;
		if (i < iconIds.length - 1) {
			cursor += gap;
		}
	}
}
