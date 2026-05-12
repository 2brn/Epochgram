import type { HoverOverlay } from "../epoch-canvas-types";
import { DROP_CAP_SCALE } from "../epoch-canvas-constants";
import type { CanvasIconCache } from "../canvas-icon-cache";

export function drawHoverOverlay(params: {
    ctx: CanvasRenderingContext2D;
    hoverOverlay: HoverOverlay;
    hoverAnim: number;
    hoverTarget: number;
    colSummaryHoverBg: string;
    iconCache: CanvasIconCache;
    epochsViewActive: boolean;
}): void {
	const { ctx, hoverOverlay: ho, epochsViewActive } = params;
	const dropCapActive = epochsViewActive || ho.isEpoch === true;

    const baseAlpha = ctx.globalAlpha;
    ctx.save();
    ctx.globalAlpha = baseAlpha * ho.alpha;

    ctx.fillStyle = ho.color;
    ctx.font = ho.font;
    ctx.textAlign = "left";

    if (
        Array.isArray(ho.lines) &&
        typeof ho.yFirstLine === "number" &&
        typeof ho.lineHeight === "number" &&
        (dropCapActive ? typeof ho.firstLineHeight === "number" : true)
    ) {
        if (ho.lines.length > 0) {
            if (dropCapActive) {
                ctx.textBaseline = "alphabetic";
            }
            const firstH = typeof ho.firstLineHeight === "number" ? ho.firstLineHeight : ho.lineHeight;
            const yTextTop =
                typeof ho.yTextTop === "number" && Number.isFinite(ho.yTextTop) ? ho.yTextTop : undefined;
            const epochDropLines =
                typeof ho.epochDropLineCount === "number" && Number.isFinite(ho.epochDropLineCount)
                    ? Math.max(0, Math.floor(ho.epochDropLineCount))
                    : 0;
            const epochHasMixed = ho.epochHasDropMixedLine === true;
            const useEpochLayout = dropCapActive && (epochsViewActive || ho.isEpoch === true) && yTextTop !== undefined;

            for (let i = 0; i < ho.lines.length; i++) {
                const line = ho.lines[i] ?? "";
                const yy = (() => {
                    if (!useEpochLayout) {
                        return i === 0
                            ? ho.yFirstLine
                            : (epochsViewActive
                                ? ho.yFirstLine + i * ho.lineHeight
                                : ho.yFirstLine + (firstH / 2 + ho.lineHeight / 2) + (i - 1) * ho.lineHeight);
                    }

                    const isDropLine = i < epochDropLines;
                    const h = isDropLine ? firstH : ho.lineHeight;
                    const ascent = Math.max(0, Math.min(h, Math.round(h * 0.8)));
                    let yLineTop = yTextTop;
                    if (epochDropLines > 0) {
                        const dropPart = Math.min(i, epochDropLines) * firstH;
                        const restPart = Math.max(0, i - epochDropLines) * ho.lineHeight;
                        yLineTop += dropPart + restPart;
                    } else {
                        yLineTop += i * ho.lineHeight;
                    }
                    return yLineTop + ascent;
                })();

                ctx.font = i === 0 && ho.firstLineFont ? ho.firstLineFont : ho.font;

                if (dropCapActive && useEpochLayout && epochDropLines > 0 && i < epochDropLines) {
                    const parseFontPx = (font: string): number => {
                        const m = String(font || "").match(/(\d+(?:\.\d+)?)px/);
                        const v = m ? parseFloat(m[1]!) : NaN;
                        return Number.isFinite(v) ? v : 12;
                    };
                    const replaceFontPx = (font: string, px: number): string => {
                        const raw = String(font || "");
                        const safePx = Number.isFinite(px) ? px : 12;
                        if (!raw) return `${safePx}px system-ui`;
                        if (!/(\d+(?:\.\d+)?)px/.test(raw)) return raw;
                        return raw.replace(/(\d+(?:\.\d+)?)px/, `${safePx.toFixed(2).replace(/\.00$/, "")}px`);
                    };
                    const drawDropCapPrefixLine = (label: string, x: number, y: number, baseFont: string, dropCapScale: number) => {
                        const t = String(label || "");
                        if (!t) return;
                        const basePx = parseFontPx(baseFont);
                        const dropPx = Math.max(basePx, basePx * dropCapScale);
                        const dropFont = replaceFontPx(baseFont, dropPx);
                        ctx.save();
                        ctx.font = dropFont;
                        ctx.fillText(t, x, y);
                        ctx.restore();
                    };

                    const drawDropCapPrefixRestLine = (
                        prefix: string,
                        rest: string,
                        x: number,
                        y: number,
                        baseFont: string,
                        dropCapScale: number
                    ) => {
                        const basePx = parseFontPx(baseFont);
                        const dropPx = Math.max(basePx, basePx * dropCapScale);
                        const dropFont = replaceFontPx(baseFont, dropPx);
                        ctx.save();
                        ctx.font = dropFont;
                        ctx.fillText(prefix, x, y);
                        const capW = ctx.measureText(prefix).width;
                        ctx.font = baseFont;
                        if (rest) ctx.fillText(rest, x + capW + 2, y);
                        ctx.restore();
                    };

                    const baseFont = ho.firstLineFont || ho.font;
                    if (i === epochDropLines - 1 && epochHasMixed) {
						const prefixPart = typeof ho.epochDropMixedPrefix === "string" ? ho.epochDropMixedPrefix : line;
						const restPart = typeof ho.epochDropMixedRest === "string" ? ho.epochDropMixedRest : "";
						drawDropCapPrefixRestLine(prefixPart, restPart, ho.x, yy, baseFont, DROP_CAP_SCALE);
                    } else {
                        drawDropCapPrefixLine(line, ho.x, yy, baseFont, DROP_CAP_SCALE);
                    }
                } else {
                    ctx.fillText(line, ho.x, yy);
                }
            }
        }
    } else if (ho.text) {
        ctx.fillText(ho.text, ho.x, ho.yCenter);
    }

    ctx.restore();
}
