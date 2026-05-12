import { describe, expect, it } from "vitest";
import { AiBridgeServer } from "../src/plugin/ai-bridge/server";

describe("AI bridge status consistency", () => {
	it("does not expose model status on the server", async () => {
		const pluginStub: any = { settings: {}, saveSettings: async () => {} };
		const server = new AiBridgeServer(pluginStub, () => {});
		const status = server.getStatus();
		expect(typeof status.clientConnected).toBe("boolean");
		expect(typeof status.queued).toBe("number");
		expect(typeof status.inProgress).toBe("number");
		expect(typeof status.processedTokens).toBe("number");
		expect("ready" in (status as any)).toBe(false);
		expect("availability" in (status as any)).toBe(false);
		expect("downloadProgress" in (status as any)).toBe(false);
	});
});
