import { describe, expect, it, vi } from "vitest";
import { hideDateOverlay, updateDateOverlay } from "../src/ui/epoch-canvas/overlay";

function makeOverlayEl(): any {
	const classSet = new Set<string>();
	return {
		style: { transition: "" },
		offsetTop: 0,
		offsetHeight: 20,
		textContent: "",
		classList: {
			add: (...names: string[]) => {
				for (const n of names) classSet.add(String(n));
			},
			remove: (...names: string[]) => {
				for (const n of names) classSet.delete(String(n));
			},
			contains: (name: string) => classSet.has(String(name))
		}
	};
}

describe("date overlay animation toggle", () => {
	it("hides immediately without requestAnimationFrame when animations are disabled", () => {
		const el = makeOverlayEl();
		el.classList.add("is-visible");
		const rafSpy = vi.fn(() => 1 as any);
		const prevRaf = (globalThis as any).requestAnimationFrame;
		(globalThis as any).requestAnimationFrame = rafSpy;

		try {
			const canvas: any = {
				dateOverlayEl: el,
				plugin: { settings: { enableAnimation: false } },
				dateOverlayTimer: null
			};

			hideDateOverlay(canvas, false);

			expect(el.classList.contains("is-visible")).toBe(false);
			expect(rafSpy).not.toHaveBeenCalled();
			expect(el.style.transition).toBe("none");
		} finally {
			(globalThis as any).requestAnimationFrame = prevRaf;
		}
	});

	it("disables and restores overlay transition based on setting", () => {
		const el = makeOverlayEl();
		const prevWindow = (globalThis as any).window;
		(globalThis as any).window = {
			...(prevWindow || {}),
			setTimeout,
			clearTimeout
		};
		const canvas: any = {
			dateOverlayEl: el,
			plugin: { settings: { enableAnimation: false } },
			dateOverlayTimer: null,
			hoverSummary: null,
			hoverDateIndex: null,
			lastDateOverlayHoverKey: "",
			lastDateOverlayValue: "",
			lastOverlayOffsetY: 999,
			lastOverlayScale: 1,
			offsetY: 0,
			scale: 1,
			getToday: () => new Date("2026-01-24T00:00:00.000Z"),
			getDateForIndex: () => new Date("2026-01-24T00:00:00.000Z")
		};

		try {
			updateDateOverlay(canvas);
			expect(el.style.transition).toBe("none");

			canvas.plugin.settings.enableAnimation = true;
			canvas.lastOverlayOffsetY = -999;
			updateDateOverlay(canvas);
			expect(el.style.transition).toBe("");

			if (canvas.dateOverlayTimer != null) {
				(globalThis as any).window.clearTimeout(canvas.dateOverlayTimer);
				canvas.dateOverlayTimer = null;
			}
		} finally {
			(globalThis as any).window = prevWindow;
		}
	});
});
