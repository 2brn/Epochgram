import { describe, expect, it, vi } from "vitest";

describe("openAiBridgeInChrome (macOS)", () => {
	it("uses 'open <url>' to open in the default browser", async () => {
		vi.resetModules();
		const openExternalMock = vi.fn();
		(Object.assign(globalThis as any, {
			require: (name: string) => {
				if (name === "electron") return { shell: { openExternal: openExternalMock } };
				throw new Error(`Unexpected require: ${name}`);
			}
		}) as any);
		Object.defineProperty(process, "platform", { value: "darwin" });

		const { openAiBridgeInChrome } = await import("../src/plugin/ai-bridge/chrome");

		openAiBridgeInChrome("http://localhost:1234/bridge");
		expect(openExternalMock).toHaveBeenCalledWith("http://localhost:1234/bridge");
	});
});
