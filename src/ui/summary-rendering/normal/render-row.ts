import type { CanvasIconCache } from "../../canvas-icon-cache";
import type { RenderRow } from "../normal-measure";
import { mixFont } from "../../epoch-canvas-utils";
import { HOVER_BG_PAD, SUMMARY_PLACEHOLDER_STROKE_WIDTH } from "../../epoch-canvas-constants";
import { drawSummaryIcons } from "../../summary-rendering-icons";
import { parseFontPx } from "../text";
import { ellipsizeToWidth } from "./ellipsis";
import { getHoverFontStrForRow } from "./hover-font";
import { splitPlusNPrefix } from "../plusn";

type TextMetricsWithBoxes = TextMetrics & {
	actualBoundingBoxAscent?: number;
	actualBoundingBoxDescent?: number;
};

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
	const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
	ctx.beginPath();
	ctx.moveTo(x + rr, y);
	ctx.arcTo(x + w, y, x + w, y + h, rr);
	ctx.arcTo(x + w, y + h, x, y + h, rr);
	ctx.arcTo(x, y + h, x, y, rr);
	ctx.arcTo(x, y, x + w, y, rr);
	ctx.closePath();
}

function fillTextWithPlusNBadge(
	ctx: CanvasRenderingContext2D,
	text: string,
	x: number,
	y: number,
	maxW: number,
	lineHeight: number,
	textColor: string,
	badgeColor: string | null = null,
	badgeStrokeNudgeY: number = 0
): void {
	const prevBaseline = ctx.textBaseline;
	ctx.textBaseline = "alphabetic";
	const fontPx = parseFontPx(ctx.font);
	const basePx = Number.isFinite(fontPx) ? fontPx : 12;
	const fontAscent = (() => {
		try {
			const m: TextMetricsWithBoxes = ctx.measureText("Mg");
			const a = Number(m.actualBoundingBoxAscent);
			return Number.isFinite(a) && a > 0 ? a : basePx * 0.8;
		} catch {
			return basePx * 0.8;
		}
	})();
	const baselineY = y + fontAscent + badgeStrokeNudgeY;

	const split = splitPlusNPrefix(text);
	if (!split) {
		const label = ellipsizeToWidth(ctx, text, maxW);
		ctx.fillStyle = textColor;
		ctx.fillText(label, x, baselineY);
		ctx.textBaseline = prevBaseline;
		return;
	}

	const badgeText = split.prefix;
	const rest = String(split.rest ?? "");
	const badgeTextColor = badgeColor || textColor;

	const padX = Math.max(3, basePx * 0.5);
	const badgeTextW = ctx.measureText(badgeText).width;
	const badgeW = badgeTextW + padX * 2;
	let ascent = basePx * 0.8;
	let descent = basePx * 0.2;
	try {
		const m: TextMetricsWithBoxes = ctx.measureText(badgeText);
		const a = Number(m.actualBoundingBoxAscent);
		const d = Number(m.actualBoundingBoxDescent);
		if (Number.isFinite(a) && a > 0) ascent = a;
		if (Number.isFinite(d) && d >= 0) descent = d;
	} catch {
		/* ignore */
	}
	const padY = Math.max(3, basePx * 0.25);
	const extraH = Math.max(1, basePx * 0.25);
	const badgeH = Math.max(basePx, ascent + descent + padY * 2 + extraH);
	const badgeCenterY = baselineY + (descent - ascent) / 2;
	const badgeY = badgeCenterY - badgeH / 2;
	const gap = Math.max(2, basePx * 0.2);
	const restMaxW = Math.max(0, maxW - badgeW - gap);
	const restLabel = ellipsizeToWidth(ctx, rest.trimStart(), restMaxW);

	ctx.save();
	const strokeW = Math.max(1, basePx * 0.1);
	const halfStroke = strokeW / 2;
	const badgeWClamped = Math.max(0, Math.min(badgeW, maxW));
	const innerW = Math.max(0, badgeWClamped - strokeW);
	const innerH = Math.max(0, badgeH - strokeW);
	if (innerW > 0.5 && innerH > 0.5) {
		roundedRectPath(ctx, x + halfStroke, badgeY + halfStroke, innerW, innerH, innerH / 2);
		ctx.strokeStyle = badgeTextColor;
		ctx.lineWidth = strokeW;
		ctx.stroke();
	}
	ctx.fillStyle = badgeTextColor;
	ctx.fillText(badgeText, x + (badgeWClamped - badgeTextW) / 2, baselineY);
	ctx.restore();

	ctx.fillStyle = textColor;
	if (typeof restLabel === "string") ctx.fillText(restLabel, x + badgeW + gap, baselineY);
	ctx.textBaseline = prevBaseline;
}

function fillTextWithPlusNBadgeSmoothEllipsis(
	ctx: CanvasRenderingContext2D,
	text: string,
	x: number,
	y: number,
	maxW: number,
	lineHeight: number,
	textColor: string,
	badgeColor: string | null = null,
	badgeStrokeNudgeY: number = 0
): void {
	const wMax = Math.max(0, Number(maxW) || 0);
	ctx.fillStyle = textColor;
	if (wMax <= 0.5) return;

	const prevBaseline = ctx.textBaseline;
	ctx.textBaseline = "alphabetic";
	const fontPx = parseFontPx(ctx.font);
	const basePx = Number.isFinite(fontPx) ? fontPx : 12;
	const fontAscent = (() => {
		try {
			const m: TextMetricsWithBoxes = ctx.measureText("Mg");
			const a = Number(m.actualBoundingBoxAscent);
			return Number.isFinite(a) && a > 0 ? a : basePx * 0.8;
		} catch {
			return basePx * 0.8;
		}
	})();
	const baselineY = y + fontAscent + badgeStrokeNudgeY;

	const ell = "…";
	const ellW = ctx.measureText(ell).width;
	if (ellW >= wMax - 0.5) return;
	const fadePx = Math.max(2, Math.min(10, ellW * 0.75));
	const clipPadY = Math.max(1, Math.round(lineHeight * 0.15));

	const split = splitPlusNPrefix(text);
	if (!split) {
		const raw = String(text ?? "");
		const rawW = ctx.measureText(raw).width;
		const overflow = rawW - wMax;
		const ellAlpha = Math.max(0, Math.min(1, (overflow + fadePx) / (fadePx * 2)));
		if (ellAlpha <= 0.001) {
			ctx.fillText(raw, x, baselineY);
			ctx.textBaseline = prevBaseline;
			return;
		}

		const clipW = Math.max(0, wMax - ellW * ellAlpha);
		ctx.save();
		ctx.beginPath();
		ctx.rect(x, y - clipPadY, clipW, Math.max(1, lineHeight) + clipPadY * 2);
		ctx.clip();
		ctx.fillText(raw, x, baselineY);
		ctx.restore();

		ctx.save();
		ctx.globalAlpha *= ellAlpha;
		ctx.fillText(ell, x + wMax - ellW, baselineY);
		ctx.restore();
		ctx.textBaseline = prevBaseline;
		return;
	}

	const badgeText = split.prefix;
	const rest = String(split.rest ?? "");
	const badgeTextColor = badgeColor || textColor;

	const padX = Math.max(3, basePx * 0.5);
	const badgeTextW = ctx.measureText(badgeText).width;
	const badgeW = badgeTextW + padX * 2;
	let ascent = basePx * 0.8;
	let descent = basePx * 0.2;
	try {
		const m: TextMetricsWithBoxes = ctx.measureText(badgeText);
		const a = Number(m.actualBoundingBoxAscent);
		const d = Number(m.actualBoundingBoxDescent);
		if (Number.isFinite(a) && a > 0) ascent = a;
		if (Number.isFinite(d) && d >= 0) descent = d;
	} catch {
		/* ignore */
	}
	const padY = Math.max(3, basePx * 0.25);
	const extraH = Math.max(1, basePx * 0.25);
	const badgeH = Math.max(basePx, ascent + descent + padY * 2 + extraH);
	const badgeCenterY = baselineY + (descent - ascent) / 2;
	const badgeY = badgeCenterY - badgeH / 2;
	const gap = Math.max(2, basePx * 0.2);
	const badgeWClamped = Math.max(0, Math.min(badgeW, wMax));

	ctx.save();
	const strokeW = Math.max(1, basePx * 0.1);
	const halfStroke = strokeW / 2;
	const innerW = Math.max(0, badgeWClamped - strokeW);
	const innerH = Math.max(0, badgeH - strokeW);
	if (innerW > 0.5 && innerH > 0.5) {
		roundedRectPath(ctx, x + halfStroke, badgeY + halfStroke, innerW, innerH, innerH / 2);
		ctx.strokeStyle = badgeTextColor;
		ctx.lineWidth = strokeW;
		ctx.stroke();
	}
	ctx.fillStyle = badgeTextColor;
	ctx.fillText(badgeText, x + (badgeWClamped - badgeTextW) / 2, baselineY);
	ctx.restore();

	const restX = x + badgeWClamped + gap;
	const restMaxW = Math.max(0, wMax - badgeWClamped - gap);
	if (restMaxW <= 0.5) return;

	const restRaw = rest.trimStart();
	const restRawW = ctx.measureText(restRaw).width;
	const overflow = restRawW - restMaxW;
	const ellAlpha = Math.max(0, Math.min(1, (overflow + fadePx) / (fadePx * 2)));
	if (ellAlpha <= 0.001) {
		ctx.fillText(restRaw, restX, baselineY);
		ctx.textBaseline = prevBaseline;
		return;
	}
	if (restMaxW <= ellW * ellAlpha + 0.5) return;

	const clipW = Math.max(0, restMaxW - ellW * ellAlpha);
	ctx.save();
	ctx.beginPath();
	ctx.rect(restX, y - clipPadY, clipW, Math.max(1, lineHeight) + clipPadY * 2);
	ctx.clip();
	ctx.fillText(restRaw, restX, baselineY);
	ctx.restore();

	ctx.save();
	ctx.globalAlpha *= ellAlpha;
	ctx.fillText(ell, restX + restMaxW - ellW, baselineY);
	ctx.restore();
	ctx.textBaseline = prevBaseline;
}

export function renderNormalRow(args: {
	ctx: CanvasRenderingContext2D;
	r: RenderRow;
	iconCache: CanvasIconCache;
	fontSmallHover: string;
	textModeEnabled: boolean;
	xStart: number;
	rowX: number;
	yItemCenter: number;
	yRectTop: number;
	yRectBottom: number;
	maxWidth: number;
	clipRight: number;
	rowT: number;
}): void {
	const {
		ctx,
		r,
		iconCache,
		fontSmallHover,
		textModeEnabled,
		xStart,
		rowX,
		yItemCenter,
		yRectTop,
		yRectBottom,
		maxWidth,
		clipRight,
		rowT
	} = args;

	const clipWidth = Math.max(0, clipRight - xStart);
	const isHoverTarget = r.isHoverTarget === true;
	const hoverT = isHoverTarget ? Math.max(0, Math.min(1, rowT)) : 0;
	const isHoverActive = isHoverTarget && hoverT > 0.001;
	const hasAnyText = r.lines.some((l) => String(l ?? "").trim().length > 0);
	const renderAsPlaceholder = !textModeEnabled;

	const hasLeadingIcons = r.leadingIconIds.length > 0;
	const leadingIconsVisible = hasLeadingIcons && clipRight - rowX >= r.leadingIconMetrics.iconsWidth - 0.5;
	const leadingIconsWidth = leadingIconsVisible ? r.leadingIconMetrics.iconsWidth : 0;
	const textGap = hasAnyText && leadingIconsVisible ? r.leadingIconMetrics.textGap : 0;
	const textStartX = rowX + leadingIconsWidth + textGap;

	let iconCenterY = yItemCenter;
	if (hasAnyText) {
		if (r.lines.length === 1) {
			// Align a single-line record (icons + text) to the day dot center.
			iconCenterY = yItemCenter;
		} else {
			const baseTextHeight = r.lines.length * r.lineHeight;
			const yTextTop = yItemCenter - baseTextHeight / 2;
			const basePx = parseFontPx(r.summaryFont);
			iconCenterY = yTextTop + (Number.isFinite(basePx) ? basePx / 2 : r.lineHeight / 2);
		}
	}
	const baseIconCenterY = iconCenterY;
	iconCenterY = baseIconCenterY;

	if (!renderAsPlaceholder) {
		ctx.save();

		// Subtle always-on tag highlight (no extra glyph): tint the row background.
		// Keep the tint tightly clipped to the row rect so it never bleeds into adjacent items.
		if (r.tagTint && hasAnyText) {
			const rowH = Math.max(0, yRectBottom - yRectTop);
			const insetY = rowH >= 4 ? 0.5 : 0;
			const bgY = yRectTop + insetY;
			const bgH = Math.max(0, rowH - insetY * 2);
			const bgPadX = Math.max(2, Math.min(HOVER_BG_PAD, Math.round(rowH * 0.2)));
			const bgX = Math.max(xStart, rowX - bgPadX);

			// Track hover/unhover animation: approximate width changes by scaling the pre-measured
			// max line width by the current mixed font px.
			const basePx = parseFontPx(r.summaryFont);
			let scaleW = 1;
			if (hoverT > 0.001) {
				const hoverFontStr = r.hoverFontStr || getHoverFontStrForRow(r, fontSmallHover);
				const mixed = mixFont(r.summaryFont, hoverFontStr, hoverT);
				const mixedPx = parseFontPx(mixed);
				if (Number.isFinite(basePx) && basePx > 0 && Number.isFinite(mixedPx) && mixedPx > 0) {
					scaleW = mixedPx / basePx;
				}
			}
			scaleW = Math.max(0.85, Math.min(1.35, scaleW));
			const effectiveTextW = r.maxLineWidth > 0 ? r.maxLineWidth * scaleW : 0;
			const effectiveDisplayW = leadingIconsWidth + (effectiveTextW > 0 ? textGap + effectiveTextW : 0);
			const bgRight = Math.min(clipRight, rowX + Math.max(0, effectiveDisplayW) + bgPadX);
			const bgW = Math.max(0, bgRight - bgX);

			if (bgW > 0.5 && bgH > 0.5) {
				ctx.save();
				ctx.beginPath();
				ctx.rect(xStart, yRectTop, clipWidth, rowH);
				ctx.clip();
				ctx.globalAlpha *= r.hiddenAlpha;
				ctx.globalAlpha *= 0.03;
				ctx.fillStyle = r.baseColor;
				roundedRectPath(ctx, bgX, bgY, bgW, bgH, Math.min(6, bgH / 2));
				ctx.fill();
				ctx.restore();
			}
		}

		if (leadingIconsVisible) {
			const effectiveLeadingMetrics = r.leadingIconMetrics;
			const iconX = rowX;
			ctx.save();
			ctx.globalAlpha *= r.hiddenAlpha;
			drawSummaryIcons(
				ctx,
				iconCache,
				r.leadingIconIds,
				r.baseColor,
				iconX,
				iconCenterY,
				effectiveLeadingMetrics.size,
				effectiveLeadingMetrics.gap
			);
			ctx.restore();
		}

		const otherLineStartX = leadingIconsVisible ? textStartX : rowX;
		if (hasAnyText) {
			const baseLines = r.lines;
			const hasHoverT = hoverT > 0.001;
			const hoverFontStr = hasHoverT ? (r.hoverFontStr || getHoverFontStrForRow(r, fontSmallHover)) : r.summaryFont;
			const hoverLH = typeof r.hoverLineHeight === "number"
				? r.hoverLineHeight
				: (hasHoverT ? Math.max(12, Math.round(parseFontPx(hoverFontStr) * 1.25)) : r.lineHeight);
			const rowLineHeight = hasHoverT ? r.lineHeight + (hoverLH - r.lineHeight) * hoverT : r.lineHeight;
			const fontStr = hasHoverT ? mixFont(r.summaryFont, hoverFontStr, hoverT) : r.summaryFont;
			// Keep wrapping stable on hover: only ellipsis/clipping changes with available width.
			const linesToRender: string[] = baseLines;

			const textClipRightRaw = clipRight;
			const textClipRight = Math.max(textStartX, Math.min(clipRight, textClipRightRaw));
			const clipWidthText = Math.max(0, textClipRight - xStart);
			const clipPadY = Math.max(1, Math.round(rowLineHeight * 0.2));
			const hoverBadgeStrokeNudgeY = 0;
			const useSmoothEllipsis = !isHoverActive || r.isHoverIncoming !== true;

			ctx.save();
			ctx.beginPath();
			ctx.rect(xStart, yRectTop - clipPadY, clipWidthText, (yRectBottom - yRectTop) + clipPadY * 2);
			ctx.clip();
			ctx.font = fontStr;
			ctx.textAlign = "left";
			ctx.textBaseline = "top";
			ctx.globalAlpha *= r.hiddenAlpha;

			const textHeight = linesToRender.length * rowLineHeight;
			let yTextTop = yItemCenter - textHeight / 2;
			if (linesToRender.length === 1) {
				try {
					const m: TextMetricsWithBoxes = ctx.measureText("Mg");
					const a = Number(m.actualBoundingBoxAscent);
					const d = Number(m.actualBoundingBoxDescent);
					const glyphH = (Number.isFinite(a) ? a : 0) + (Number.isFinite(d) ? d : 0);
					if (glyphH > 0.5) {
						yTextTop = yItemCenter - glyphH / 2;
					}
				} catch {
					// ignore; fallback uses line-height centering
				}
			}

			const textColor = r.baseColor;
			if (linesToRender.length === 1) {
				const xLine = textStartX;
				const maxTextW = Math.max(0, textClipRight - textStartX);
				const raw = String(r.textToWrap ?? linesToRender[0] ?? "");
				if (!useSmoothEllipsis) {
					fillTextWithPlusNBadge(ctx, raw, xLine, yTextTop, maxTextW, rowLineHeight, textColor, r.plusNBadgeColor ?? null, hoverBadgeStrokeNudgeY);
				} else {
					fillTextWithPlusNBadgeSmoothEllipsis(ctx, raw, xLine, yTextTop, maxTextW, rowLineHeight, textColor, r.plusNBadgeColor ?? null, 0);
				}
			} else {
				for (let li = 0; li < linesToRender.length; li++) {
					const xLine = li === 0 ? textStartX : otherLineStartX;
					const maxTextW = Math.max(0, textClipRight - xLine);
					const text = String(linesToRender[li] ?? "").trimEnd();
					if (!useSmoothEllipsis) {
						if (li === 0) {
							fillTextWithPlusNBadge(ctx, text, xLine, yTextTop + li * rowLineHeight, maxTextW, rowLineHeight, textColor, r.plusNBadgeColor ?? null, hoverBadgeStrokeNudgeY);
						} else {
							const label = ellipsizeToWidth(ctx, text, maxTextW);
							ctx.fillStyle = textColor;
							ctx.fillText(label, xLine, yTextTop + li * rowLineHeight);
						}
					} else {
						fillTextWithPlusNBadgeSmoothEllipsis(ctx, text, xLine, yTextTop + li * rowLineHeight, maxTextW, rowLineHeight, textColor, r.plusNBadgeColor ?? null, 0);
					}
				}
			}
			ctx.restore();
		}

		ctx.restore();
		return;
	}

	ctx.save();
	ctx.globalAlpha *= r.hiddenAlpha;
	ctx.strokeStyle = r.baseColor;
	const baseStroke = SUMMARY_PLACEHOLDER_STROKE_WIDTH;
	ctx.lineWidth = baseStroke;
	// Placeholder width should be stable (no jitter on hover/click/active-file changes).
	// Match dense-bar width behavior: use the full available width (not text measurement).
	const len = Math.max(10, maxWidth);
	ctx.beginPath();
	ctx.moveTo(rowX, yItemCenter);
	ctx.lineTo(rowX + len, yItemCenter);
	ctx.stroke();
	// Placeholder hover should not linger during outgoing animations.
	const activeHoverT = r.isActiveEntry ? 1 : 0;
	const lineHoverT = Math.max(activeHoverT, r.isHoverIncoming ? Math.max(0, Math.min(1, r.summaryHoverT)) : 0);
	if (lineHoverT > 0.001) {
		ctx.save();
		// Match dense bar hover behavior: increased opacity and increased "height".
		ctx.globalAlpha *= Math.min(1, 0.5 + 1.25 * lineHoverT);
		ctx.strokeStyle = r.hoverSummaryColor;
		// Use the same sizing curve as dense-bar hover so the highlighted thickness matches.
		const extraH = Math.min(4, Math.max(1.25, baseStroke * 0.25));
		ctx.lineWidth = baseStroke + extraH * lineHoverT;
		ctx.beginPath();
		ctx.moveTo(rowX, yItemCenter);
		ctx.lineTo(rowX + len, yItemCenter);
		ctx.stroke();
		ctx.restore();
	}
	ctx.restore();
}
