import { HOVER_BG_PAD, HOVER_EXTRA_GAP, SUMMARY_MIN_SCALE, SUMMARY_RECORD_SAFE_MARGIN } from "../../epoch-canvas-constants";
import { parseFontPx } from "../text";
import type { RenderColumn } from "../normal-measure";
import { ellipsizeLineToRight } from "./ellipsis";
import { getHoverFontStrForRow } from "./hover-font";

export type HoverLineBand = { yTop: number; yBottom: number; right: number };
export type RowLayout = { yTop: number; yBottom: number; rowX: number };

export type HoverLayoutResult = {
	textModeEnabled: boolean;
	detailHoverScale: number;
	recordSafeGap: number;
	hoveredColIdx: number;
	hoveredRowIdx: number;
	hoveredT: number;
	shiftRightDx: number;
	rowLayoutByCol: RowLayout[][];
};

export function computeHoverLayout(args: {
	ctx: CanvasRenderingContext2D;
	columns: RenderColumn[];
	dayIndex: number;
	dayCenterY: number;
	xStart: number;
	rightWidth: number;
	scale: number;
	rowHeight: number;
	animSummary: { dayIndex: number; itemIndex: number } | null;
	fontSmallHover: string;
	allowRightColumnShift?: boolean;
	allowVerticalNeighborShift?: boolean;
	allowRowHeightExpansion?: boolean;
}): HoverLayoutResult {
	const { ctx, columns, dayIndex, dayCenterY, xStart, rightWidth, scale, rowHeight, animSummary, fontSmallHover } = args;
	const allowRightColumnShift = args.allowRightColumnShift !== false;
	const allowVerticalNeighborShift = args.allowVerticalNeighborShift !== false;
	const allowRowHeightExpansion = args.allowRowHeightExpansion !== false;

	const recordSafeGap = HOVER_EXTRA_GAP + SUMMARY_RECORD_SAFE_MARGIN;
	const textModeEnabled = scale >= SUMMARY_MIN_SCALE;
	const detailHoverScale = textModeEnabled ? 1 : 0;

	let hoveredColIdx = -1;
	let hoveredRowIdx = -1;
	let hoveredT = 0;
	for (let ci = 0; ci < columns.length; ci++) {
		const rr = columns[ci]!.rows;
		for (let ri = 0; ri < rr.length; ri++) {
			const r = rr[ri]!;
			const t = Math.max(0, Math.min(1, r.summaryHoverT)) * detailHoverScale;
			if (t <= 0) continue;
			const isIncoming = !!(animSummary && animSummary.dayIndex === dayIndex && animSummary.itemIndex === r.entryIndex);
			const bestIsIncoming =
				!!(
					animSummary &&
					hoveredColIdx >= 0 &&
					columns[hoveredColIdx]?.rows?.[hoveredRowIdx] &&
					animSummary.dayIndex === dayIndex &&
					animSummary.itemIndex === columns[hoveredColIdx]!.rows[hoveredRowIdx]!.entryIndex
				);
			if (t > hoveredT + 1e-6 || (Math.abs(t - hoveredT) <= 1e-6 && isIncoming && !bestIsIncoming)) {
				hoveredColIdx = ci;
				hoveredRowIdx = ri;
				hoveredT = t;
			}
		}
	}

	let shiftRightDx = 0;
	if (allowRightColumnShift && hoveredColIdx >= 0 && hoveredColIdx < columns.length - 1 && hoveredT > 0) {
		const hoveredCol = columns[hoveredColIdx]!;
		const r = hoveredCol.rows[hoveredRowIdx]!;
		const hasAnyText = r.lines.some((l) => String(l ?? "").trim().length > 0);
		if (hasAnyText) {
			const hoverFontStr = getHoverFontStrForRow(r, fontSmallHover);
			const textGap = r.leadingIconMetrics.textGap;
			const textStartX = hoveredCol.x + r.leadingIconMetrics.iconsWidth + (hasAnyText ? textGap : 0);
			const otherLineStartX = r.leadingIconIds.length > 0 ? textStartX : hoveredCol.x;
			const baseTagGap = r.hasTagIcon ? r.tagIconMetrics.textGap : 0;
			const hoverTagSize = r.hasTagIcon ? r.tagIconMetrics.size : 0;
			const hoverTagExtraWidth = r.hasTagIcon ? baseTagGap + hoverTagSize : 0;
			const nextColBaseX = columns[hoveredColIdx + 1]!.x;
			const rightEdge = xStart + rightWidth;
			const linesNow = Array.isArray(r.lines) && r.lines.length ? r.lines : [""];

			ctx.save();
			ctx.font = hoverFontStr;
			const textRightLimit = rightEdge - hoverTagExtraWidth - HOVER_BG_PAD;

			const measureRight = (lines: string[]): number => {
				let best = 0;
				for (let li = 0; li < lines.length; li++) {
					const startX = li === 0 ? textStartX : otherLineStartX;
					const line = ellipsizeLineToRight(ctx, String(lines[li] ?? "").trimEnd(), startX, textRightLimit);
					const right = startX + ctx.measureText(line).width;
					if (right > best) best = right;
				}
				return best;
			};

			const currRight = measureRight(linesNow);
			const hoverTextRight = currRight;
			ctx.restore();

			const hoverRight = hoverTextRight + hoverTagExtraWidth;
			const desiredNextX = hoverRight + recordSafeGap;
			const overlap = desiredNextX - nextColBaseX;
			shiftRightDx = (overlap > 0 ? overlap : 0) * hoveredT;
		}
	}

	// When shifting columns right for hover, do it only for rows whose vertical span intersects
	// the hovered row's hover rect. This prevents shifting unrelated rows in other "right columns".
	let hoverShiftYTop: number | null = null;
	let hoverShiftYBottom: number | null = null;

	const rowLayoutByCol: RowLayout[][] = [];
	for (let colIdx = 0; colIdx < columns.length; colIdx++) {
		const col = columns[colIdx]!;
		const { x, rowsThisCol, rows } = col;
		const rightEdge = xStart + rightWidth;
		const baseX = x;

		// Base (non-hover) row centers: stable anchor for local collision resolution.
		const baseCenterByRow: number[] = [];
		{
			let yCursorBase = dayCenterY - col.columnHeight / 2;
			for (let i = 0; i < rowsThisCol; i++) {
				const r = rows[i]!;
				const top = yCursorBase;
				const bottom = top + r.height;
				baseCenterByRow[i] = (top + bottom) / 2;
				yCursorBase = bottom;
			}
		}

		// Effective (possibly expanded) row rect heights. We keep the hovered row centered at its
		// base center, and only shift neighbors as needed to prevent overlap.
		const rectHeightByRow: number[] = [];
		for (let i = 0; i < rowsThisCol; i++) {
			const r = rows[i]!;
			let h = r.height;
			const rowT = (colIdx === hoveredColIdx && i === hoveredRowIdx)
				? (Math.max(0, Math.min(1, r.summaryHoverT)) * detailHoverScale)
				: 0;
			if (allowRowHeightExpansion && rowT > 0) {
				const hasAnyText = r.lines.some((l) => String(l ?? "").trim().length > 0);
				if (hasAnyText) {
					const hoverFontStr = getHoverFontStrForRow(r, fontSmallHover);

					const textGap = r.leadingIconMetrics.textGap;
					const textStartX = baseX + r.leadingIconMetrics.iconsWidth + textGap;
					const otherLineStartX = r.leadingIconIds.length > 0 ? textStartX : baseX;
					const baseTagGap = r.hasTagIcon ? r.tagIconMetrics.textGap : 0;

					const hoverBasePx = parseFontPx(r.summaryFont);
					const hoverPx = parseFontPx(hoverFontStr);
					const hoverIconScale =
						Number.isFinite(hoverBasePx) && hoverBasePx > 0 && Number.isFinite(hoverPx) ? Math.max(1, hoverPx / hoverBasePx) : 1;
					const hoverTagSize = r.hasTagIcon ? r.tagIconMetrics.size : 0;
					const hoverTagExtraWidth = r.hasTagIcon ? baseTagGap + hoverTagSize : 0;

					r.hoverFontStr = hoverFontStr;
					r.hoverLineHeight = Math.max(12, Math.round(parseFontPx(hoverFontStr) * 1.25));
					r.hoverIconScale = hoverIconScale;
					r.hoverTagExtraWidth = hoverTagExtraWidth;

					ctx.save();
					ctx.font = hoverFontStr;
					const textRightLimit = rightEdge - hoverTagExtraWidth - HOVER_BG_PAD;
					const hoverLines = Array.isArray(r.lines) && r.lines.length ? r.lines : [""];
					let hoverTextRight = 0;
					let hoverMaxLineWidth = 0;
					for (let li = 0; li < hoverLines.length; li++) {
						const startX = li === 0 ? textStartX : otherLineStartX;
						const line = ellipsizeLineToRight(ctx, String(hoverLines[li] ?? "").trimEnd(), startX, textRightLimit);
						const w = ctx.measureText(line).width;
						if (w > hoverMaxLineWidth) hoverMaxLineWidth = w;
						const right = startX + w;
						if (right > hoverTextRight) hoverTextRight = right;
					}
					ctx.restore();

					r.hoverLines = hoverLines;
					r.hoverMaxLineWidth = hoverMaxLineWidth;
					r.hoverTextRight = hoverTextRight;
					const hoverTextHeight = hoverLines.length * (r.hoverLineHeight || r.lineHeight);
					r.hoverHeight = Math.max(rowHeight, hoverTextHeight + r.padY * 2);
					h = r.height + ((r.hoverHeight - r.height) * rowT);
				}
			}
			rectHeightByRow[i] = h;
		}

		const anchorRow = colIdx === hoveredColIdx ? hoveredRowIdx : -1;
		const hasAnchor = anchorRow >= 0 && anchorRow < rowsThisCol && hoveredT > 0.001;
		const centers: number[] = baseCenterByRow.slice();
		if (hasAnchor && allowVerticalNeighborShift) {
			centers[anchorRow] = baseCenterByRow[anchorRow]!;

			const TEXT_OVERLAP_EPS_PX = 0.5;

			const rowHasAnyText = (row: number): boolean => {
				const rr = rows[row]!;
				return rr.lines.some((l) => String(l ?? "").trim().length > 0);
			};

			const textHalfHeightBase = (row: number): number => {
				const rr = rows[row]!;
				if (!rowHasAnyText(row)) return 0;
				const lines = Array.isArray(rr.lines) ? rr.lines : [];
				const lineCount = Math.max(1, lines.length || 0);
				const lh = typeof rr.lineHeight === "number" ? rr.lineHeight : 0;
				const h = Math.max(0, lineCount * lh);
				return h / 2;
			};

			const anchorCenter = baseCenterByRow[anchorRow]!;
			const anchorLines = Array.isArray(rows[anchorRow]!.hoverLines) && rows[anchorRow]!.hoverLines!.length ? rows[anchorRow]!.hoverLines! : rows[anchorRow]!.lines;
			const anchorLineCount = rowHasAnyText(anchorRow) ? Math.max(1, anchorLines.length || 0) : 0;
			const anchorHoverLH = typeof rows[anchorRow]!.hoverLineHeight === "number" ? rows[anchorRow]!.hoverLineHeight! : rows[anchorRow]!.lineHeight;
			const anchorTextHalfHFull = anchorLineCount > 0 ? Math.max(0, anchorLineCount * anchorHoverLH) / 2 : 0;
			const anchorTextTopFull = anchorCenter - anchorTextHalfHFull;
			const anchorTextBottomFull = anchorCenter + anchorTextHalfHFull;

			// Normal-mode hover packing rule:
			// - Keep the hovered row anchored to its base center.
			// - Only the immediate row above may move up.
			// - Only the immediate row below may move down.
			// Neighbors only move if the hovered row's *text box* would overlap their *text box*
			// at full hover (no padding); movement scales with hoveredT.
			const aboveRow = anchorRow - 1;
			const belowRow = anchorRow + 1;

			if (aboveRow >= 0 && aboveRow < rowsThisCol) {
				const aboveCenterBase = baseCenterByRow[aboveRow]!;
				const aboveHalfH = textHalfHeightBase(aboveRow);
				const aboveBottomTextBase = aboveCenterBase + aboveHalfH;
				const overlapPxFull = aboveBottomTextBase - (anchorTextTopFull - TEXT_OVERLAP_EPS_PX);
				let shiftUp = overlapPxFull > 0 ? overlapPxFull * hoveredT : 0;
				if (!Number.isFinite(shiftUp) || shiftUp < 0) shiftUp = 0;

				// Clamp so we don't overlap the row two-above (text-only overlap).
				const above2Row = aboveRow - 1;
				if (shiftUp > 0 && above2Row >= 0) {
					const above2Center = baseCenterByRow[above2Row]!;
					const above2HalfH = textHalfHeightBase(above2Row);
					const above2BottomTextBase = above2Center + above2HalfH;
					const aboveTopTextBase = aboveCenterBase - aboveHalfH;
					const maxShiftUp = aboveTopTextBase - (above2BottomTextBase + TEXT_OVERLAP_EPS_PX);
					if (Number.isFinite(maxShiftUp)) {
						shiftUp = Math.min(shiftUp, Math.max(0, maxShiftUp));
					}
				}
				centers[aboveRow] = aboveCenterBase - shiftUp;
			}

			if (belowRow >= 0 && belowRow < rowsThisCol) {
				const belowCenterBase = baseCenterByRow[belowRow]!;
				const belowHalfH = textHalfHeightBase(belowRow);
				const belowTopTextBase = belowCenterBase - belowHalfH;
				const overlapPxFull = (anchorTextBottomFull + TEXT_OVERLAP_EPS_PX) - belowTopTextBase;
				let shiftDown = overlapPxFull > 0 ? overlapPxFull * hoveredT : 0;
				if (!Number.isFinite(shiftDown) || shiftDown < 0) shiftDown = 0;

				// Clamp so we don't overlap the row two-below (text-only overlap).
				const below2Row = belowRow + 1;
				if (shiftDown > 0 && below2Row < rowsThisCol) {
					const below2Center = baseCenterByRow[below2Row]!;
					const below2HalfH = textHalfHeightBase(below2Row);
					const below2TopTextBase = below2Center - below2HalfH;
					const belowBottomTextBase = belowCenterBase + belowHalfH;
					const maxShiftDown = below2TopTextBase - (belowBottomTextBase + TEXT_OVERLAP_EPS_PX);
					if (Number.isFinite(maxShiftDown)) {
						shiftDown = Math.min(shiftDown, Math.max(0, maxShiftDown));
					}
				}
				centers[belowRow] = belowCenterBase + shiftDown;
			}
		}

		// Capture the hovered row's full hover-rect vertical range (at full hover, not interpolated).
		// This range is later used to decide which rows in columns to the right should shift.
		if (
			allowRightColumnShift &&
			shiftRightDx > 0.001 &&
			hoverShiftYTop == null &&
			hoverShiftYBottom == null &&
			colIdx === hoveredColIdx &&
			hasAnchor
		) {
			const rAnchor = rows[anchorRow]!;
			const yCenter = baseCenterByRow[anchorRow]!;
			const fullH = allowRowHeightExpansion ? (rAnchor.hoverHeight ?? rAnchor.height) : rAnchor.height;
			if (Number.isFinite(fullH) && fullH > 0) {
				hoverShiftYTop = yCenter - fullH / 2;
				hoverShiftYBottom = yCenter + fullH / 2;
			}
		}

		const layouts: RowLayout[] = [];
		for (let row = 0; row < rowsThisCol; row++) {
			const r = rows[row]!;
			const yBaseCenter = baseCenterByRow[row]!;
			const rectH = rectHeightByRow[row] ?? r.height;
			const centerForRect = allowVerticalNeighborShift ? centers[row]! : yBaseCenter;
			const yRectTop = centerForRect - rectH / 2;
			const yRectBottom = centerForRect + rectH / 2;

			const shouldShiftRowRight =
				allowRightColumnShift &&
				shiftRightDx > 0.001 &&
				hoveredColIdx >= 0 &&
				hoveredT > 0.001 &&
				colIdx > hoveredColIdx &&
				hoverShiftYTop != null &&
				hoverShiftYBottom != null &&
				!(yRectBottom <= hoverShiftYTop || yRectTop >= hoverShiftYBottom);

			const rowX = x + (shouldShiftRowRight ? shiftRightDx : 0);

			layouts.push({ yTop: yRectTop, yBottom: yRectBottom, rowX });
		}
		rowLayoutByCol.push(layouts);
	}

	return {
		textModeEnabled,
		detailHoverScale,
		recordSafeGap,
		hoveredColIdx,
		hoveredRowIdx,
		hoveredT,
		shiftRightDx,
		rowLayoutByCol
	};
}
