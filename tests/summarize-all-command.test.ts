import { describe, expect, it, vi } from "vitest";
import { withTrustedPro } from "./helpers/trusted-pro";

vi.mock("../src/plugin/ai-summaries/epochs-after-ai", async (importOriginal) => {
	const actual: any = await importOriginal();
	return {
		...actual,
		scheduleEpochRegenerationAfterAiIdle: vi.fn()
	};
});

describe("Summarize all command behavior", () => {
	it("respects Auto summarize: when OFF, does not enqueue AI summaries", async () => {
		const { regenerateMissingAiSummariesAndEpochsForAllRecords } = await import(
			"../src/plugin/ai-summaries/methods-regenerate"
		);
		const epochsAfterAi = await import("../src/plugin/ai-summaries/epochs-after-ai");
		const scheduleSpy = (epochsAfterAi as any).scheduleEpochRegenerationAfterAiIdle as any;
		scheduleSpy.mockClear();

		const pluginStub: any = {
			hasProAccess: () => true,
			settings: { generateEpochs: true, summarizeAI: false },
			generateMissingAiSummariesForAllRecords: vi.fn(),
			regenerateMissingEpochsForAllRecords: vi.fn(),
			ensureIndexLoaded: vi.fn()
		};
		withTrustedPro(pluginStub);

		await regenerateMissingAiSummariesAndEpochsForAllRecords.call(pluginStub);

		expect(pluginStub.generateMissingAiSummariesForAllRecords).not.toHaveBeenCalled();
		expect(scheduleSpy).not.toHaveBeenCalled();
		expect(pluginStub.regenerateMissingEpochsForAllRecords).toHaveBeenCalledTimes(1);
	});

	it("when Auto summarize is ON, queues missing AI summaries and schedules missing epochs", async () => {
		const { regenerateMissingAiSummariesAndEpochsForAllRecords } = await import(
			"../src/plugin/ai-summaries/methods-regenerate"
		);
		const epochsAfterAi = await import("../src/plugin/ai-summaries/epochs-after-ai");
		const scheduleSpy = (epochsAfterAi as any).scheduleEpochRegenerationAfterAiIdle as any;
		scheduleSpy.mockClear();

		const pluginStub: any = {
			hasProAccess: () => true,
			settings: { generateEpochs: true, summarizeAI: true },
			generateMissingAiSummariesForAllRecords: vi.fn(),
			regenerateMissingEpochsForAllRecords: vi.fn(),
			ensureIndexLoaded: vi.fn()
		};
		withTrustedPro(pluginStub);

		await regenerateMissingAiSummariesAndEpochsForAllRecords.call(pluginStub);

		expect(pluginStub.generateMissingAiSummariesForAllRecords).toHaveBeenCalledTimes(1);
		expect(scheduleSpy).toHaveBeenCalledTimes(1);
		expect(scheduleSpy).toHaveBeenCalledWith(pluginStub, "missing", true);
		expect(pluginStub.regenerateMissingEpochsForAllRecords).not.toHaveBeenCalled();
	});

	it("does not schedule missing epochs if canceled during missing summaries run", async () => {
		const { regenerateMissingAiSummariesAndEpochsForAllRecords } = await import(
			"../src/plugin/ai-summaries/methods-regenerate"
		);
		const epochsAfterAi = await import("../src/plugin/ai-summaries/epochs-after-ai");
		const scheduleSpy = (epochsAfterAi as any).scheduleEpochRegenerationAfterAiIdle as any;
		scheduleSpy.mockClear();

		const pluginStub: any = {
			hasProAccess: () => true,
			settings: { generateEpochs: true, summarizeAI: true },
			__epochAiEnqueueCancelKey: 0,
			generateMissingAiSummariesForAllRecords: vi.fn(async function (this: any) {
				this.__epochAiEnqueueCancelKey = 1;
			}),
			regenerateMissingEpochsForAllRecords: vi.fn(),
			ensureIndexLoaded: vi.fn()
		};
		withTrustedPro(pluginStub);

		await regenerateMissingAiSummariesAndEpochsForAllRecords.call(pluginStub);

		expect(pluginStub.generateMissingAiSummariesForAllRecords).toHaveBeenCalledTimes(1);
		expect(scheduleSpy).not.toHaveBeenCalled();
		expect(pluginStub.regenerateMissingEpochsForAllRecords).not.toHaveBeenCalled();
	});

	it("does not schedule epochs when generateEpochs is disabled", async () => {
		const { regenerateMissingAiSummariesAndEpochsForAllRecords } = await import(
			"../src/plugin/ai-summaries/methods-regenerate"
		);
		const epochsAfterAi = await import("../src/plugin/ai-summaries/epochs-after-ai");
		const scheduleSpy = (epochsAfterAi as any).scheduleEpochRegenerationAfterAiIdle as any;
		scheduleSpy.mockClear();

		const pluginStub: any = {
			hasProAccess: () => true,
			settings: { generateEpochs: false, summarizeAI: true },
			generateMissingAiSummariesForAllRecords: vi.fn(),
			regenerateMissingEpochsForAllRecords: vi.fn(),
			ensureIndexLoaded: vi.fn()
		};
		withTrustedPro(pluginStub);

		await regenerateMissingAiSummariesAndEpochsForAllRecords.call(pluginStub);

		expect(pluginStub.generateMissingAiSummariesForAllRecords).toHaveBeenCalledTimes(1);
		expect(scheduleSpy).not.toHaveBeenCalled();
		expect(pluginStub.regenerateMissingEpochsForAllRecords).not.toHaveBeenCalled();
	});
});
