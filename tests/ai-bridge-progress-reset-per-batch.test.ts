import { beforeEach, describe, expect, it, vi } from "vitest";
import { Platform } from "obsidian";
import { withTrustedPro } from "./helpers/trusted-pro";

const progressTexts: string[] = [];

vi.mock("../src/plugin/progress", () => {
	return {
		clearEpochProgress: vi.fn(),
		setEpochProgress: vi.fn((_plugin: any, _kind: any, text: string) => {
			progressTexts.push(String(text));
		})
	};
});

import { refreshAiBridgeProgress } from "../src/plugin/ai-bridge-progress";

describe("ai bridge progress resets per batch", () => {
	beforeEach(() => {
		progressTexts.length = 0;
		Platform.isDesktopApp = true;
		Platform.isMobileApp = false;
	});

	it("starts each new batch from zero processed", () => {
		const status: any = {
			queued: 0,
			inProgress: 0,
			done: 100,
			errors: 5,
			epochTotal: 0,
			epochProcessed: 0
		};

		const plugin: any = {
			hasProAccess: () => true,
			aiBridge: {
				pending: [],
				inProgress: new Map(),
				getStatus: () => ({ ...status })
			}
		};
		withTrustedPro(plugin);

		refreshAiBridgeProgress(plugin);

		status.queued = 4;
		refreshAiBridgeProgress(plugin);

		status.queued = 2;
		status.done = 102;
		refreshAiBridgeProgress(plugin);

		status.queued = 0;
		status.inProgress = 0;
		status.done = 104;
		refreshAiBridgeProgress(plugin);

		status.queued = 3;
		refreshAiBridgeProgress(plugin);

		expect(progressTexts).toEqual([
			"Summarization… 0/4",
			"Summarization… 2/4",
			"Summarization… 0/3"
		]);
	});
});
