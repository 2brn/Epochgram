import { describe, expect, it } from "vitest";

import { Platform } from "obsidian";
import { loadAiBridgeServer } from "../src/plugin/ai-bridge";

describe("AI bridge environment guard", () => {
	it("does not call require() when mobile emulation is active", async () => {
		const originalDesktop = Platform.isDesktopApp;
		const originalMobile = Platform.isMobileApp;
		const originalRequire = (globalThis as any).require;
		const originalProcess = (globalThis as any).process;
		let requireCalls = 0;
		try {
			Platform.isDesktopApp = true;
			Platform.isMobileApp = true;
			(globalThis as any).process = { versions: { node: "20.0.0" } };
			(globalThis as any).require = () => {
				requireCalls++;
				throw new Error("require() should not be called");
			};

			await expect(loadAiBridgeServer()).rejects.toThrow(/AI bridge is not available/i);
			expect(requireCalls).toBe(0);
		} finally {
			Platform.isDesktopApp = originalDesktop;
			Platform.isMobileApp = originalMobile;
			(globalThis as any).require = originalRequire;
			(globalThis as any).process = originalProcess;
		}
	});
});
