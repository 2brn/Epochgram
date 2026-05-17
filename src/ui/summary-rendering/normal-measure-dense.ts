import type { DateEntry } from "../../indexer/types";
import {
	BASE_SPACING,
	SUMMARY_COLUMN_GAP,
	SUMMARY_MARGIN,
	SUMMARY_MAX_COL_WIDTH,
	SUMMARY_MIN_SCALE
} from "../epoch-canvas-constants";
import { entrySummaryComponents, withFontWeight } from "../epoch-canvas-utils";
import { formatDate } from "utils";
import { getSummaryIconMetrics } from "../summary-rendering-icons";

export function computeNeedsDenseByWidthFast(args: {
	ctx: CanvasRenderingContext2D;
	entries: DateEntry[];
	xStart: number;
	rightWidth: number;
	compactMinWidthBaseWidth?: number;
	scale: number;
	rowHeight: number;
	fontSmall: string;
	activeFilePath: string | null;
	pathsWithEmbeddingTerm?: Set<string> | null;
	pathsWithClassifiedTerm?: Set<string> | null;
	termSimilarPaths?: Set<string> | null;
	compactMinWidthRatio?: number;
}): boolean {
	const { ctx } = args;
	const entries = Array.isArray(args.entries) ? args.entries : [];
	if (entries.length === 0) return false;

	const scale = Number(args.scale);
	const rowHeight = Number(args.rowHeight);
	if (!Number.isFinite(scale) || !Number.isFinite(rowHeight) || rowHeight <= 0) return false;

	// Mirror buildNormalColumns' band/column math.
	const halfSpan = Math.max(rowHeight / 2, (BASE_SPACING * scale) / 2 - SUMMARY_MARGIN);
	const bandHeight = Math.max(rowHeight, halfSpan * 2);
	const maxRows = Math.max(1, Math.floor(bandHeight / rowHeight));
	const itemsPerCol = Math.max(1, Math.min(maxRows, entries.length));
	const columnCount = Math.ceil(entries.length / itemsPerCol);

	const rightWidth = Number(args.rightWidth);
	const xStart = Number(args.xStart);
	if (!Number.isFinite(rightWidth) || !Number.isFinite(xStart)) return false;
	const compactMinWidthRatioRaw = Number(args.compactMinWidthRatio ?? 0);
	const compactMinWidthRatio = Number.isFinite(compactMinWidthRatioRaw)
		? Math.max(0, Math.min(1, compactMinWidthRatioRaw))
		: 0;
	const compactMinWidthBaseWidthRaw = Number(args.compactMinWidthBaseWidth ?? rightWidth);
	const compactMinWidthBaseWidth = Number.isFinite(compactMinWidthBaseWidthRaw) && compactMinWidthBaseWidthRaw > 0
		? compactMinWidthBaseWidthRaw
		: rightWidth;
	const compactMinWidthPx = scale > SUMMARY_MIN_SCALE ? compactMinWidthBaseWidth * compactMinWidthRatio : 0;

	const colWidth = Math.min(
		SUMMARY_MAX_COL_WIDTH,
		(rightWidth - (columnCount - 1) * SUMMARY_COLUMN_GAP) / columnCount
	);

	// Measure ellipsis width conservatively (bold tends to be widest).
	const fontSmall = args.fontSmall;
	ctx.save();
	ctx.font = fontSmall;
	const ellWBase = ctx.measureText("ΓÇª").width;
	ctx.font = withFontWeight(fontSmall, "700");
	const ellWBold = ctx.measureText("ΓÇª").width;
	ctx.restore();
	const ellW = Math.max(ellWBase, ellWBold);

	// Safe early-out: if even the worst-case row (1 leading icon) in the
	// narrowest column (last column) can fit an ellipsis, then no row can be too narrow.
	// This avoids scanning every entry in very large days.
	const rightEdge = xStart + rightWidth;
	const lastColX = xStart + (columnCount - 1) * (colWidth + SUMMARY_COLUMN_GAP);
	const leadingWorst = getSummaryIconMetrics(1, rowHeight);
	const worstTextStartX = lastColX + leadingWorst.iconsWidth + leadingWorst.textGap;
	const worstMaxTextWidth = Math.max(0, rightEdge - worstTextStartX);
	if (worstMaxTextWidth > ellW + 0.5 && (compactMinWidthPx <= 0 || worstMaxTextWidth > compactMinWidthPx + 0.5)) {
		return false;
	}

	// Fall back to exact scan.
	const activePath = args.activeFilePath;

	const todayKey = formatDate(new Date());
	for (let col = 0; col < columnCount; col++) {
		const startIndex = col * itemsPerCol;
		if (startIndex >= entries.length) break;
		const endIndex = Math.min(startIndex + itemsPerCol, entries.length);
		const rowsThisCol = endIndex - startIndex;

		const x = xStart + col * (colWidth + SUMMARY_COLUMN_GAP);

		for (let row = 0; row < rowsThisCol; row++) {
			const entryIndex = startIndex + row;
			const entry = entries[entryIndex]!;

			const summaryComponents = entrySummaryComponents(entry);
			const iconIds = summaryComponents.iconIds.slice().filter((id) => id !== "tag");
			const leadingIconIds = iconIds;
			const leadingIconMetrics = getSummaryIconMetrics(leadingIconIds.length, rowHeight);

			// Bold rows (active, today+pinned) reserve slightly more for ellipsis.
			const isActiveEntry = !!(activePath && entry.file === activePath);
			const isTodayEntry = entry.date === todayKey;
			const needsBoldFont = isActiveEntry || (entry.pinned === true && isTodayEntry);
			const ellEffective = needsBoldFont ? ellW : ellW;

			const suffixReserve = 0;
			const textStartX = x + leadingIconMetrics.iconsWidth + (leadingIconMetrics.totalWidth > 0 ? leadingIconMetrics.textGap : 0);
			const maxTextWidth = Math.max(0, rightEdge - textStartX - suffixReserve);
			if (maxTextWidth <= ellEffective + 0.5 || (compactMinWidthPx > 0 && maxTextWidth <= compactMinWidthPx + 0.5)) return true;
		}
	}

	return false;
}
