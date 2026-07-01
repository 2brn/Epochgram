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
	const { columns, ctx, dayIndex, dayCenterY, xStart, rightWidth, scale, rowHeight, animSummary, fontSmallHover } = args;
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
		const rr = columns[ci]?.rows ?? [];
		for (let ri = 0; ri < rr.length; ri++) {
			const r = rr[ri];
			if (!r) continue;
			const t = Math.max(0, Math.min(1, r.summaryHoverT)) * detailHoverScale;
			if (t <= 0) continue;
			const isIncoming = !!(animSummary && animSummary.dayIndex === dayIndex && animSummary.itemIndex === r.entryIndex);
			const bestRow = hoveredColIdx >= 0 ? columns[hoveredColIdx]?.rows?.[hoveredRowIdx] : null;
			const bestIsIncoming =
				!!(
					animSummary &&
					hoveredColIdx >= 0 &&
					bestRow &&
					animSummary.dayIndex === dayIndex &&
					animSummary.itemIndex === bestRow.entryIndex
				);
			if (t > hoveredT + 1e-6 || (Math.abs(t - hoveredT) <= 1e-6 && isIncoming && !bestIsIncoming)) {
				hoveredColIdx = ci;
				hoveredRowIdx = ri;
				hoveredT = t;
			}
		}
	}

	type RowYRange = { yTop: number; yBottom: number };
	const baseRowRangesByCol: RowYRange[][] = columns.map((col) => {
		const ranges: RowYRange[] = [];
		let y = dayCenterY - col.columnHeight / 2;
		for (let row = 0; row < col.rowsThisCol; row++) {
			const r = col.rows[row];
			if (!r) continue;
			const yTop = y;
			const yBottom = yTop + r.height;
			ranges.push({ yTop, yBottom });
			y = yBottom;
		}
		return ranges;
	});

	let shiftRightDx = 0;
	if (allowRightColumnShift && hoveredColIdx >= 0 && hoveredT > 0) {
		const hoveredRowIsSingle = isSingleInRow(baseRowRangesByCol, hoveredColIdx, hoveredRowIdx);
		if (hoveredRowIsSingle) {
			shiftRightDx = 0;
		} else {
			const hoveredCol = columns[hoveredColIdx];
			const hoveredRow = hoveredCol?.rows?.[hoveredRowIdx];
			if (!hoveredCol || !hoveredRow) {
				shiftRightDx = 0;
			} else {
			const nextCol = columns[hoveredColIdx + 1] ?? null;
			if (nextCol) {
				const baseX = hoveredCol.x;
				const hoverFontStr = hoveredRow.hoverFontStr || getHoverFontStrForRow(hoveredRow, fontSmallHover);
				const hasAnyText = hoveredRow.lines.some((l) => String(l ?? "").trim().length > 0);
				let hoverTextRight = baseX;
				if (hasAnyText) {
					const textGap = hoveredRow.leadingIconMetrics.textGap;
					const textStartX = baseX + hoveredRow.leadingIconMetrics.iconsWidth + textGap;
					const otherLineStartX = hoveredRow.leadingIconIds.length > 0 ? textStartX : baseX;
					const baseTagGap = hoveredRow.hasTagIcon ? hoveredRow.tagIconMetrics.textGap : 0;
					const hoverTagSize = hoveredRow.hasTagIcon ? hoveredRow.tagIconMetrics.size : 0;
					const hoverTagExtraWidth = hoveredRow.hasTagIcon ? baseTagGap + hoverTagSize : 0;
					const textRightLimit = xStart + rightWidth - hoverTagExtraWidth - HOVER_BG_PAD;
					ctx.save();
					ctx.font = hoverFontStr;
					const hoverLines = Array.isArray(hoveredRow.lines) && hoveredRow.lines.length ? hoveredRow.lines : [""];
					for (let li = 0; li < hoverLines.length; li++) {
						const startX = li === 0 ? textStartX : otherLineStartX;
						const line = ellipsizeLineToRight(ctx, String(hoverLines[li] ?? "").trimEnd(), startX, textRightLimit);
						const right = startX + ctx.measureText(line).width + hoverTagExtraWidth;
						if (right > hoverTextRight) hoverTextRight = right;
					}
					ctx.restore();
				}
				const overlap = Math.max(0, hoverTextRight + recordSafeGap - nextCol.x);
				shiftRightDx = overlap * hoveredT;
			}
			}
		}
	}

	// When shifting columns right for hover, do it only for rows whose vertical span intersects
	// the hovered row's hover rect. This prevents shifting unrelated rows in other "right columns".
	let hoverShiftYTop: number | null = null;
	let hoverShiftYBottom: number | null = null;

	const rowLayoutByCol: RowLayout[][] = [];
	for (let colIdx = 0; colIdx < columns.length; colIdx++) {
		const col = columns[colIdx];
		if (!col) {
			rowLayoutByCol.push([]);
			continue;
		}
		const { x, rowsThisCol, rows } = col;
		const rightEdge = xStart + rightWidth;
		const baseX = x;

		// Base (non-hover) row centers: stable anchor for local collision resolution.
		const baseCenterByRow: number[] = [];
		{
			let yCursorBase = dayCenterY - col.columnHeight / 2;
			for (let i = 0; i < rowsThisCol; i++) {
				const r = rows[i];
				if (!r) {
					baseCenterByRow[i] = yCursorBase;
					continue;
				}
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
			const r = rows[i];
			if (!r) {
				rectHeightByRow[i] = rowHeight;
				continue;
			}
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
			const anchorCenterBase = baseCenterByRow[anchorRow];
			if (anchorCenterBase == null) continue;
			centers[anchorRow] = anchorCenterBase;

			const TEXT_OVERLAP_EPS_PX = 0.5;

			const rowHasAnyText = (row: number): boolean => {
				const rr = rows[row];
				if (!rr) return false;
				return rr.lines.some((l) => String(l ?? "").trim().length > 0);
			};

			const textHalfHeightBase = (row: number): number => {
				const rr = rows[row];
				if (!rr) return 0;
				if (!rowHasAnyText(row)) return 0;
				const lines = Array.isArray(rr.lines) ? rr.lines : [];
				const lineCount = Math.max(1, lines.length || 0);
				const lh = typeof rr.lineHeight === "number" ? rr.lineHeight : 0;
				const h = Math.max(0, lineCount * lh);
				return h / 2;
			};

			const anchorCenter = anchorCenterBase;
			const anchorRowData = rows[anchorRow];
			if (!anchorRowData) continue;
			const anchorLines =
				Array.isArray(anchorRowData.hoverLines) && anchorRowData.hoverLines.length
					? anchorRowData.hoverLines
					: anchorRowData.lines;
			const anchorLineCount = rowHasAnyText(anchorRow) ? Math.max(1, anchorLines.length || 0) : 0;
			const anchorHoverLH =
				typeof anchorRowData.hoverLineHeight === "number" ? anchorRowData.hoverLineHeight : anchorRowData.lineHeight;
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
				const aboveCenterBase = baseCenterByRow[aboveRow];
				if (aboveCenterBase == null) continue;
				const aboveHalfH = textHalfHeightBase(aboveRow);
				const aboveBottomTextBase = aboveCenterBase + aboveHalfH;
				const overlapPxFull = aboveBottomTextBase - (anchorTextTopFull - TEXT_OVERLAP_EPS_PX);
				let shiftUp = overlapPxFull > 0 ? overlapPxFull * hoveredT : 0;
				if (!Number.isFinite(shiftUp) || shiftUp < 0) shiftUp = 0;

				// Clamp so we don't overlap the row two-above (text-only overlap).
				const above2Row = aboveRow - 1;
				if (shiftUp > 0 && above2Row >= 0) {
					const above2Center = baseCenterByRow[above2Row];
					if (above2Center == null) continue;
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
				const belowCenterBase = baseCenterByRow[belowRow];
				if (belowCenterBase == null) continue;
				const belowHalfH = textHalfHeightBase(belowRow);
				const belowTopTextBase = belowCenterBase - belowHalfH;
				const overlapPxFull = (anchorTextBottomFull + TEXT_OVERLAP_EPS_PX) - belowTopTextBase;
				let shiftDown = overlapPxFull > 0 ? overlapPxFull * hoveredT : 0;
				if (!Number.isFinite(shiftDown) || shiftDown < 0) shiftDown = 0;

				// Clamp so we don't overlap the row two-below (text-only overlap).
				const below2Row = belowRow + 1;
				if (shiftDown > 0 && below2Row < rowsThisCol) {
					const below2Center = baseCenterByRow[below2Row];
					if (below2Center == null) continue;
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
			const rAnchor = rows[anchorRow];
			if (!rAnchor) {
				// no-op when anchor row is unavailable
			} else {
				const yCenter = baseCenterByRow[anchorRow];
				if (yCenter == null) continue;
				const fullH = allowRowHeightExpansion ? (rAnchor.hoverHeight ?? rAnchor.height) : rAnchor.height;
				if (Number.isFinite(fullH) && fullH > 0) {
					hoverShiftYTop = yCenter - fullH / 2;
					hoverShiftYBottom = yCenter + fullH / 2;
				}
			}
		}

		const layouts: RowLayout[] = [];
		for (let row = 0; row < rowsThisCol; row++) {
			const r = rows[row];
			if (!r) continue;
			const yBaseCenter = baseCenterByRow[row];
			if (yBaseCenter == null) continue;
			const rectH = rectHeightByRow[row] ?? r.height;
			const centerForRect = allowVerticalNeighborShift ? centers[row] ?? yBaseCenter : yBaseCenter;
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

function isSingleInRow(baseRowRangesByCol: { yTop: number; yBottom: number }[][], colIdx: number, rowIdx: number): boolean {
	const target = baseRowRangesByCol[colIdx]?.[rowIdx];
	if (!target) return false;
	const overlapAllowancePx = 1;
	const targetCenter = (target.yTop + target.yBottom) / 2;
	const targetTop = Math.min(targetCenter, target.yTop + overlapAllowancePx);
	const targetBottom = Math.max(targetCenter, target.yBottom - overlapAllowancePx);
	for (let cj = 0; cj < baseRowRangesByCol.length; cj++) {
		const ranges = baseRowRangesByCol[cj];
		if (!ranges) continue;
		for (let rj = 0; rj < ranges.length; rj++) {
			if (cj === colIdx && rj === rowIdx) continue;
				const other = ranges[rj];
				if (!other) continue;
			const overlapsY = !(targetBottom <= other.yTop || targetTop >= other.yBottom);
			if (overlapsY) {
				return false;
			}
		}
	}
	return true;
}
