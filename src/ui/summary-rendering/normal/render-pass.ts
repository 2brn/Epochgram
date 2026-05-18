import type { CanvasIconCache } from "../../canvas-icon-cache";
import type { SummaryRect } from "../../epoch-canvas-types";
import { HOVER_HIT_PAD, TOUCH_HIT_PAD } from "../../epoch-canvas-constants";
import type { RenderColumn } from "../normal-measure";
import { getHoverFontStrForRow } from "./hover-font";
import type { HoverLineBand, RowLayout } from "./hover-layout";
import { renderNormalRow } from "./render-row";

export function renderNormalColumnsPass(args: {
	ctx: CanvasRenderingContext2D;
	columns: RenderColumn[];
	dayIndex: number;
	dayCenterY: number;
	viewportTop?: number;
	viewportBottom?: number;
	xStart: number;
	rightWidth: number;
	rowHeight: number;
	iconCache: CanvasIconCache;
	fontSmallHover: string;
	wrapFadeCache?: Map<string, any> | null;
	textModeEnabled: boolean;
	detailHoverScale: number;
	hoveredColIdx: number;
	hoveredRowIdx: number;
	hoveredT: number;
	shiftRightDx: number;
	recordSafeGap: number;
	rowLayoutByCol: RowLayout[][];
}): { summaryRects: SummaryRect[]; summaryHoverRects: SummaryRect[] } {
	const {
		ctx,
		columns,
		dayIndex,
		dayCenterY,
		viewportTop,
		viewportBottom,
		xStart,
		rightWidth,
		iconCache,
		fontSmallHover,
		wrapFadeCache,
		textModeEnabled,
		detailHoverScale,
		hoveredColIdx,
		hoveredRowIdx,
		recordSafeGap,
		rowLayoutByCol
	} = args;

	const vt = Number(viewportTop);
	const vb = Number(viewportBottom);
	const hasViewport = Number.isFinite(vt) && Number.isFinite(vb) && vb > vt;

	const summaryRects: SummaryRect[] = [];
	const summaryHoverRects: SummaryRect[] = [];

	const ellipsisDt = Number(wrapFadeCache?.get("__ellipsisDt"));
	const ellipsisAnimMs = Number(wrapFadeCache?.get("__ellipsisAnimMs"));


	type HoverLineBandInternal = HoverLineBand;
	type BandSource = { colIdx: number; t: number; bands: HoverLineBandInternal[] };
	const bandSources: BandSource[] = [];

	// Precompute base (non-hover) row Y ranges for every column.
	// This is used for "base" clipping so that hover-driven vertical shifts in other
	// columns don't cause non-hover rows to suddenly gain/lose clipping (ellipsis changes).
	type RowYRange = { yTop: number; yBottom: number };
	const baseRowRangesByCol: RowYRange[][] = columns.map((col) => {
		const ranges: RowYRange[] = [];
		let y = dayCenterY - col.columnHeight / 2;
		for (let row = 0; row < col.rowsThisCol; row++) {
			const r = col.rows[row]!;
			const yTop = y;
			const yBottom = yTop + r.height;
			ranges.push({ yTop, yBottom });
			y = yBottom;
		}
		return ranges;
	});

	const isSingleInRow = (colIdx: number, rowIdx: number): boolean => {
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
				const other = ranges[rj]!;
				const overlapsY = !(targetBottom <= other.yTop || targetTop >= other.yBottom);
				if (overlapsY) {
					return false;
				}
			}
		}
		return true;
	};

	for (let colIdx = 0; colIdx < columns.length; colIdx++) {
		const col = columns[colIdx]!;
		const { x, maxWidth, rowsThisCol, rows } = col;
		const rightEdge = xStart + rightWidth;
		const baseX = x;
		const layoutsForCol = rowLayoutByCol[colIdx] ?? null;

		// Modify the logic to prevent other records from shifting when hovering over a single-row record
		const getClipRightEdgeForRowShifted = (yTop: number, yBottom: number): number => {
			if (isSingleInRow(hoveredColIdx, hoveredRowIdx)) {
				// If the hovered row is a single-row record, prevent any shifting globally
				return rightEdge;
			}
			if (isSingleInRow(colIdx, hoveredRowIdx)) {
				// If the current column contains a single-row record, prevent shifting
				return rightEdge;
			}
			for (let cj = colIdx + 1; cj < columns.length; cj++) {
				const other = rowLayoutByCol[cj];
				if (!other) continue;
				for (let rj = 0; rj < other.length; rj++) {
					const o = other[rj]!;
					if (yBottom <= o.yTop || yTop >= o.yBottom) continue;
					return o.rowX - recordSafeGap;
				}
			}
			return rightEdge;
		};

		const getClipRightEdgeForRowBase = (yTop: number, yBottom: number): number => {
			for (let cj = colIdx + 1; cj < columns.length; cj++) {
				const other = baseRowRangesByCol[cj];
				if (!other) continue;
				for (let rj = 0; rj < other.length; rj++) {
					const o = other[rj]!;
					if (yBottom <= o.yTop || yTop >= o.yBottom) continue;
					return columns[cj]!.x - recordSafeGap;
				}
			}
			return rightEdge;
		};

		const getClipRightEdgeForBandsShifted = (bands: HoverLineBandInternal[]): number => {
			for (let cj = colIdx + 1; cj < columns.length; cj++) {
				const other = rowLayoutByCol[cj];
				if (!other) continue;
				for (let rj = 0; rj < other.length; rj++) {
					const o = other[rj]!;
					for (let bi = 0; bi < bands.length; bi++) {
						const b = bands[bi]!;
						if (b.yBottom <= o.yTop || b.yTop >= o.yBottom) continue;
						return o.rowX - recordSafeGap;
					}
				}
			}
			return rightEdge;
		};

		let yCursorBase = dayCenterY - col.columnHeight / 2;

		for (let row = 0; row < rowsThisCol; row++) {
			const r = rows[row]!;
			const rowIsSingleInRow = isSingleInRow(colIdx, row);
			const rowT = Math.max(0, Math.min(1, r.summaryHoverT)) * detailHoverScale;
			const yRectTopBase = yCursorBase;
			const yRectBottomBase = yRectTopBase + r.height;

			const layout = layoutsForCol?.[row] ?? null;
			const yRectTop = layout ? layout.yTop : yRectTopBase;
			const yRectBottom = layout ? layout.yBottom : yRectBottomBase;
			const isHoveredRow = rowT > 0;
			const isAnchorRow = isHoveredRow && colIdx === hoveredColIdx && row === hoveredRowIdx;
			const yBaseCenter = (yRectTopBase + yRectBottomBase) / 2;
			const yItemCenter = isAnchorRow ? yBaseCenter : (yRectTop + yRectBottom) / 2;

			if (hasViewport && (yRectBottom <= vt || yRectTop >= vb)) {
				yCursorBase = yRectBottomBase;
				continue;
			}

			const hasAnyText = r.lines.some((l) => String(l ?? "").trim().length > 0);
			let hoverBandsForClip: HoverLineBandInternal[] | null = null;
			if (hasAnyText && rowT > 0.001) {
				const hoverFontStr = r.hoverFontStr || getHoverFontStrForRow(r, fontSmallHover);
				const hoverLineHeight = typeof r.hoverLineHeight === "number" ? r.hoverLineHeight : r.lineHeight;
				const linesNow = Array.isArray(r.hoverLines) && r.hoverLines.length ? r.hoverLines : r.lines;
				const hoverTextHeight = linesNow.length * hoverLineHeight;
				const yHoverTextTop = yItemCenter - hoverTextHeight / 2;
				const tagExtra = typeof r.hoverTagExtraWidth === "number" ? r.hoverTagExtraWidth : 0;
				const textGapForBands = hasAnyText ? r.leadingIconMetrics.textGap : 0;
				const hoverTextStartX = baseX + r.leadingIconMetrics.iconsWidth + textGapForBands;
				const otherLineStartX = r.leadingIconIds.length > 0 ? hoverTextStartX : baseX;

				let rightInterp = 0;
				try {
					ctx.save();
					ctx.font = hoverFontStr;
					for (let li = 0; li < linesNow.length; li++) {
						const line = String(linesNow[li] ?? "").trimEnd();
						const startX = li === 0 ? hoverTextStartX : otherLineStartX;
						const right = startX + ctx.measureText(line).width;
						if (right > rightInterp) rightInterp = right;
					}
					ctx.restore();
				} catch {
					try {
						ctx.restore();
					} catch {
						/* ignore */
					}
				}
				const bandCount = linesNow.length;
				const bands: HoverLineBandInternal[] =
					bandCount > 0
						? [{ yTop: yHoverTextTop, yBottom: yHoverTextTop + bandCount * hoverLineHeight, right: rightInterp + tagExtra }]
						: [];
				if (bands.length) {
					bandSources.push({ colIdx, t: Math.max(0, Math.min(1, rowT)), bands });
					hoverBandsForClip = bands;
				}
			}

			const rowX = layout ? layout.rowX : baseX;
			const rowShift = rowX - baseX;

			// For non-hover rows, keep the *ellipsis width* stable while shifting the row,
			// by shifting the clip edge alongside the row. This ensures hovering only
			// re-ellipsizes the hovered (or animating-out) record.
			const baseClipRight = rowIsSingleInRow ? rightEdge : getClipRightEdgeForRowBase(yRectTopBase, yRectBottomBase);

			const isActiveHoveredRow = colIdx === hoveredColIdx && row === hoveredRowIdx && isHoveredRow;
			let clipRight = isActiveHoveredRow
				? (rowIsSingleInRow
					? rightEdge
					: (hoverBandsForClip && hoverBandsForClip.length
						? getClipRightEdgeForBandsShifted(hoverBandsForClip)
						: getClipRightEdgeForRowShifted(yRectTop, yRectBottom)))
				: baseClipRight;
			if (!r.isHoverTarget && Number.isFinite(rowShift) && rowShift > 0.001) {
				clipRight = Math.min(rightEdge, baseClipRight + rowShift);
			}
			if (isActiveHoveredRow) {
				// Keep the hovered row clipped against any shifted bands.
				// (Band sources are unioned for shifting, so this is a conservative clip.)
				//
				// Note: clipRight expansion below applies to outgoing rows too.
			}
			// Only the currently-hovered (incoming) row should change ellipsing.
			// Outgoing rows keep their base ellipsis while animating out.
			if (r.isHoverIncoming && rowT > 0.001) {
				const t = Math.max(0, Math.min(1, rowT));
				clipRight = clipRight + (rightEdge - clipRight) * t;
			}

			if (wrapFadeCache) {
				const key = `clipRight:${dayIndex}:${r.entryIndex}`;
				const prev = Number(wrapFadeCache.get(key));
				const hasPrev = Number.isFinite(prev);
				const diff = hasPrev ? Math.abs(clipRight - prev) : 0;
				const canAnimate =
					Number.isFinite(ellipsisAnimMs) &&
					ellipsisAnimMs > 0 &&
					Number.isFinite(ellipsisDt) &&
					ellipsisDt > 0 &&
					diff > 0.25;

				// Smooth any clipRight change (hover in/out, neighbor shifts, etc.).
				// This prevents one-frame “ellipsis pops” when widths change quickly.
				if (canAnimate) {
					const from = hasPrev ? prev : clipRight;
					// Treat ellipsisAnimMs as a *duration to settle*, not a time constant.
					// Old behavior (t = dt / animMs) converges very slowly (exp(-1) after animMs).
					// This maps animMs to ~99% convergence over animMs.
					const tLin = ellipsisDt / ellipsisAnimMs;
					const t =
						tLin >= 1
							? 1
							: tLin <= 0
								? 0
								: 1 - Math.exp(-Math.log(100) * tLin);
					const next = from + (clipRight - from) * t;
					wrapFadeCache.set(key, next);
					if (Math.abs(clipRight - next) > 0.5) {
						wrapFadeCache.set("__ellipsisAnimating", true);
					}
					clipRight = next;
				} else {
					wrapFadeCache.set(key, clipRight);
				}
			}

			renderNormalRow({
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
			});

			summaryRects.push({
				x1: rowX - TOUCH_HIT_PAD,
				y1: yRectTop - TOUCH_HIT_PAD,
				x2: clipRight + TOUCH_HIT_PAD,
				y2: yRectBottom + TOUCH_HIT_PAD,
				itemIndex: r.entryIndex,
				entry: r.entry,
				// Metadata for click handling: when text mode is disabled, rows render as placeholder strokes.
				isPlaceholder: !textModeEnabled
			} as any);

			summaryHoverRects.push({
				x1: Math.min(baseX, rowX) - HOVER_HIT_PAD,
				y1: yRectTopBase - HOVER_HIT_PAD,
				x2:
					(rowIsSingleInRow ? rightEdge : getClipRightEdgeForRowBase(yRectTopBase, yRectBottomBase)) +
					(Math.max(0, rowShift) || 0) +
					HOVER_HIT_PAD,
				y2: yRectBottomBase + HOVER_HIT_PAD,
				itemIndex: r.entryIndex,
				entry: r.entry,
				isPlaceholder: !textModeEnabled
			} as any);

			yCursorBase = yRectBottomBase;
		}
	}

	return { summaryRects, summaryHoverRects };
}
