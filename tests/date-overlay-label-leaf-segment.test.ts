import { describe, expect, it } from "vitest";
import { computeDateOverlayLabel } from "../src/ui/epoch-canvas/overlay";

describe("date overlay label", () => {
	it("uses only the leaf segment for folder-like Daily Notes formats", () => {
		const prevMoment = (globalThis as any).window?.moment;
		(globalThis as any).window = {
			...(globalThis as any).window,
			moment: (_date: any) => ({
				format: (_fmt: string) => "2026/01/2026-01-24"
			})
		};

		const canvas: any = {
			dateOverlayEl: { offsetTop: 0, offsetHeight: 0 },
			scale: 1,
			offsetY: 0,
			getToday: () => new Date("2026-01-24T00:00:00.000Z"),
			getDateForIndex: (_index: number, _today: Date) => new Date("2026-01-24T00:00:00.000Z"),
			getNoteNameForDate: () => "2026-01-24",
			plugin: {
				getDailyNoteFormat: () => "YYYY/MM/YYYY-MM-DD"
			}
		};

		expect(computeDateOverlayLabel(canvas)).toBe("2026-01-24");

		if (prevMoment === undefined) {
			delete (globalThis as any).window.moment;
		} else {
			(globalThis as any).window.moment = prevMoment;
		}
	});
});
