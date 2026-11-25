import type { HoverOverlay } from "../epoch-canvas-types";
import type { CanvasIconCache } from "../canvas-icon-cache";
export function drawHoverOverlay(params: { ctx: CanvasRenderingContext2D; hoverOverlay: HoverOverlay; hoverAnim: number; hoverTarget: number; colSummaryHoverBg: string; iconCache: CanvasIconCache }): void {
    const { ctx, hoverOverlay: overlay } = params;
    ctx.save();
    ctx.globalAlpha *= overlay.alpha;
    ctx.fillStyle = overlay.color;
    ctx.font = overlay.font;
    ctx.textAlign = "left";
    if (Array.isArray(overlay.lines) && typeof overlay.yFirstLine === "number" && typeof overlay.lineHeight === "number") {
        const firstHeight = overlay.firstLineHeight ?? overlay.lineHeight;
        for (let i = 0; i < overlay.lines.length; i++) {
            ctx.font = i === 0 && overlay.firstLineFont ? overlay.firstLineFont : overlay.font;
            const y = i === 0 ? overlay.yFirstLine : overlay.yFirstLine + (firstHeight + overlay.lineHeight) / 2 + (i - 1) * overlay.lineHeight;
            ctx.fillText(overlay.lines[i] ?? "", overlay.x, y);
        }
    } else if (overlay.text) ctx.fillText(overlay.text, overlay.x, overlay.yCenter);
    ctx.restore();
}
