import { withFontStyle, withFontWeight } from "../../epoch-canvas-utils";
import { parseFontPx } from "../text";
import type { RenderRow } from "../normal-measure";

export function getHoverFontStrForRow(row: Pick<RenderRow, "summaryFont" | "needsBoldFont" | "isDraft">, fontSmallHover: string): string {
	let hoverFontStr = fontSmallHover;
	if (row.needsBoldFont) hoverFontStr = withFontWeight(hoverFontStr, "700");
	if (row.isDraft) hoverFontStr = withFontStyle(hoverFontStr, "italic");
	const basePx = parseFontPx(row.summaryFont);
	const hoverPx = parseFontPx(hoverFontStr);
	if (Number.isFinite(basePx) && Number.isFinite(hoverPx) && hoverPx + 0.01 < basePx) return row.summaryFont;
	return hoverFontStr;
}
