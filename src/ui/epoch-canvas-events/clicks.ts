import type { EpochCanvas } from "../epoch-canvas";
import { getEventState, isWheelInteractionSuppressed } from "./state";
import { handleDoublePoint, handlePointClick } from "./interactions";
import { TAP_MAX_DURATION } from "../epoch-canvas-constants";

export async function handleClick(canvas: EpochCanvas, event: MouseEvent): Promise<void> {
	const s = getEventState(canvas);
	// Mobile: touch handlers own tap/press; ignore mouse click handlers.
	const hasPointer = typeof s.isPointerDeviceEvent === "function" ? s.isPointerDeviceEvent() : true;
	if (!hasPointer) return;
	// Many touch devices emit a synthetic click after touchend.
	// Touch taps are handled in the touch handler; ignore touch-sourced clicks.
	try {
		if ((event as any)?.sourceCapabilities?.firesTouchEvents) {
			return;
		}
	} catch {
		// ignore
	}
	if (isWheelInteractionSuppressed(s)) return;
	const now = performance.now();
	const dt = now - s.mouseDownTime;
	const maxDuration = s.isPointerDeviceEvent() ? 600 : TAP_MAX_DURATION;

	if (s.mouseMoved || dt > maxDuration) {
		return;
	}

	const rect = s.canvas.getBoundingClientRect();
	const x = event.clientX - rect.left;
	const y = event.clientY - rect.top;

	const isMiddle = event.button === 1;
	await handlePointClick(
		canvas,
		x,
		y,
		isMiddle || event.ctrlKey,
		event.metaKey
	);
}

export async function handleDoubleClick(canvas: EpochCanvas, event: MouseEvent): Promise<void> {
	const s = getEventState(canvas);
	const hasPointer = typeof s.isPointerDeviceEvent === "function" ? s.isPointerDeviceEvent() : true;
	if (!hasPointer) return;
	if (isWheelInteractionSuppressed(s)) return;
	const rect = s.canvas.getBoundingClientRect();
	const x = event.clientX - rect.left;
	const y = event.clientY - rect.top;
	if (s.epochsView) {
		const hit = s.findSummaryEntryAtPoint(x, y);
		if (hit) return;
	}
	await handleDoublePoint(canvas, x, y);
}

export async function handleAuxClick(canvas: EpochCanvas, event: MouseEvent): Promise<void> {
	const s = getEventState(canvas);
	const hasPointer = typeof s.isPointerDeviceEvent === "function" ? s.isPointerDeviceEvent() : true;
	if (!hasPointer) return;
	if (event.button !== 1) return;
	if (isWheelInteractionSuppressed(s)) return;
	const now = performance.now();
	const dt = now - s.mouseDownTime;
	const maxDuration = s.isPointerDeviceEvent() ? 600 : TAP_MAX_DURATION;
	if (s.mouseMoved || dt > maxDuration) return;

	event.preventDefault();

	const rect = s.canvas.getBoundingClientRect();
	const x = event.clientX - rect.left;
	const y = event.clientY - rect.top;

	await handlePointClick(canvas, x, y, true, event.metaKey);
}

export function handleContextMenu(canvas: EpochCanvas, event: MouseEvent): void {
	const s = getEventState(canvas);
	const hasPointer = typeof s.isPointerDeviceEvent === "function" ? s.isPointerDeviceEvent() : true;
	if (!hasPointer) return;
	const rect = s.canvas.getBoundingClientRect();
	const x = event.clientX - rect.left;
	const y = event.clientY - rect.top;

	let entry = s.findSummaryEntryAtPoint(x, y);
	let day = entry ? null : s.findDayLayoutAtPoint(x, y);

	if (!entry && !day) {
		try {
			const hoverSummary = s.hoverSummary as { dayIndex: number; itemIndex: number } | null;
			if (hoverSummary) {
				for (const layout of s.layouts ?? []) {
					if (layout.index !== hoverSummary.dayIndex) continue;
					for (const r of layout.summaryRects ?? []) {
						if (r.itemIndex === hoverSummary.itemIndex) {
							entry = r.entry;
							break;
						}
					}
					if (entry) break;
				}
			}
			if (!entry) {
				const hoverDateIndex = s.hoverDateIndex as number | null;
				if (hoverDateIndex != null) {
					for (const layout of s.layouts ?? []) {
						if (layout.index === hoverDateIndex) {
							day = layout;
							break;
						}
					}
				}
			}
		} catch {
			// ignore
		}
	}

	event.preventDefault();

	if (!entry && !day) {
		s.keepHoverAfterMenu = false;
		s.toggleEmptyAreaView();
		return;
	}

	if (entry) {
		s.keepHoverAfterMenu = true;
		s.updateHover(x, y);
		s.showSummaryMenu(entry, event.clientX, event.clientY);
		return;
	}

	if (day) {
		s.keepHoverAfterMenu = true;
		s.updateHover(x, y);
		s.showDateMenu(day.index, event.clientX, event.clientY);
	}
}
