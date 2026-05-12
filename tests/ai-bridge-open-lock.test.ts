import { describe, expect, it, vi } from "vitest";

import { openAiBridgeWindow } from "../src/plugin/ai-summaries/methods-bridge";
import { withTrustedPro } from "./helpers/trusted-pro";

describe("AI bridge open lock", () => {
	it("prevents duplicate openInChrome calls even with forceOpen", async () => {
		const g: any = globalThis as any;
		delete g.__epochAiBridgeOpenLockUntil;
		delete g.__epochAiBridgeLastOpenAt;
		delete g.__epochAiBridgeLastCloseAt;

		let openCount = 0;
		const bridgeStub: any = {
			getStatus: () => ({ clientConnected: false, queued: 0, inProgress: 0 }),
			openInChrome: vi.fn(async () => {
				openCount++;
			})
		};

		const plugin: any = {
			hasProAccess: () => true,
			settings: { openAiBridgeOnStartup: true },
			aiBridge: bridgeStub,
			aiBridgeStartPromise: null
		};
		withTrustedPro(plugin);

		// First call acquires lock and opens.
		await openAiBridgeWindow.call(plugin, { silent: false, source: "maintenance", forceOpen: true });
		// Second call happens immediately; must not open a second tab.
		await openAiBridgeWindow.call(plugin, { silent: false, source: "maintenance", forceOpen: true });

		expect(openCount).toBe(1);
		expect(bridgeStub.openInChrome).toHaveBeenCalledTimes(1);
	});
});
