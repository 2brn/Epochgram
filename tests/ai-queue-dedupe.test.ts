import { describe, it, expect } from "vitest";
import type { AiSummaryJob } from "../src/plugin/ai-bridge";
import { AiBridgeServer } from "../src/plugin/ai-bridge/server";

function makeJob(overrides: Partial<AiSummaryJob> = {}): AiSummaryJob {
	return {
		id: overrides.id ?? Math.random().toString(16).slice(2),
		filePath: overrides.filePath ?? "note.md",
		kind: overrides.kind ?? "content",
		date: overrides.date ?? "2025-12-27",
		blockStart: overrides.blockStart ?? 0,
		blockEnd: overrides.blockEnd ?? 0,
		source: overrides.source ?? "content",
		input: overrides.input ?? "hello world",
		context: overrides.context ?? "",
		inputHash: overrides.inputHash ?? "hash",
		createdAt: overrides.createdAt ?? Date.now(),
		groupId: overrides.groupId,
		chunkIndex: overrides.chunkIndex,
		chunkCount: overrides.chunkCount,
		groupType: overrides.groupType,
		groupDate: overrides.groupDate,
		targets: overrides.targets,
		epochBucket: overrides.epochBucket,
		epochStart: overrides.epochStart,
		epochEnd: overrides.epochEnd
	};
}

describe("AI bridge queue de-duplication", () => {
	it("drops older duplicate pending jobs (keeps newest)", () => {
		const plugin: any = { settings: {} };
		const bridge = new AiBridgeServer(plugin, () => {});

		const j1 = makeJob({ id: "old", createdAt: 1, inputHash: "oldhash" });
		const j2 = makeJob({ id: "new", createdAt: 2, inputHash: "newhash" });

		bridge.enqueue([j1]);
		bridge.enqueue([j2]);

		const pending = (bridge as any).pending as AiSummaryJob[];
		expect(pending).toHaveLength(1);
		expect(pending[0]!.id).toBe("new");
	});

	it("drops older duplicate in-progress jobs when re-queued", () => {
		const plugin: any = { settings: {} };
		const bridge = new AiBridgeServer(plugin, () => {});

		const old = makeJob({ id: "old", createdAt: 1, inputHash: "oldhash" });
		(bridge as any).inProgress.set(old.id, old);
		(bridge as any).inProgressTokens = 123;

		const newer = makeJob({ id: "new", createdAt: 2, inputHash: "newhash" });
		bridge.enqueue([newer]);

		expect((bridge as any).inProgress.size).toBe(0);
		const pending = (bridge as any).pending as AiSummaryJob[];
		expect(pending).toHaveLength(1);
		expect(pending[0]!.id).toBe("new");
	});

	it("de-dupes epoch jobs by bucket+range", () => {
		const plugin: any = { settings: {} };
		const bridge = new AiBridgeServer(plugin, () => {});

		const j1 = makeJob({
			id: "e1",
			kind: "epoch",
			filePath: "epoch://month/2025-01-01-2025-01-31",
			date: "2025-01-01",
			source: "epoch",
			epochBucket: "month",
			epochStart: "2025-01-01",
			epochEnd: "2025-01-31",
			createdAt: 1
		});
		const j2 = makeJob({
			id: "e2",
			kind: "epoch",
			filePath: "epoch://month/2025-01-01-2025-01-31",
			date: "2025-01-01",
			source: "epoch",
			epochBucket: "month",
			epochStart: "2025-01-01",
			epochEnd: "2025-01-31",
			createdAt: 2
		});

		bridge.enqueue([j1, j2]);

		const pending = (bridge as any).pending as AiSummaryJob[];
		expect(pending).toHaveLength(1);
		expect(pending[0]!.id).toBe("e2");
	});

	it("does not de-dupe chunked epoch jobs across chunk indices", () => {
		const plugin: any = { settings: {} };
		const bridge = new AiBridgeServer(plugin, () => {});

		const c0 = makeJob({
			id: "c0",
			kind: "epoch",
			filePath: "epoch://year/2025-01-01-2025-12-31",
			date: "2025-01-01",
			source: "epoch",
			epochBucket: "year",
			epochStart: "2025-01-01",
			epochEnd: "2025-12-31",
			groupId: "g",
			chunkIndex: 0,
			chunkCount: 2,
			createdAt: 1
		});
		const c1 = makeJob({
			id: "c1",
			kind: "epoch",
			filePath: "epoch://year/2025-01-01-2025-12-31",
			date: "2025-01-01",
			source: "epoch",
			epochBucket: "year",
			epochStart: "2025-01-01",
			epochEnd: "2025-12-31",
			groupId: "g",
			chunkIndex: 1,
			chunkCount: 2,
			createdAt: 2
		});

		bridge.enqueue([c0, c1]);
		const pending = (bridge as any).pending as AiSummaryJob[];
		expect(pending).toHaveLength(2);
		expect(new Set(pending.map(p => p.id))).toEqual(new Set(["c0", "c1"]));
	});

	it("de-dupes chunked epoch jobs within the same chunk index", () => {
		const plugin: any = { settings: {} };
		const bridge = new AiBridgeServer(plugin, () => {});

		const older = makeJob({
			id: "older",
			kind: "epoch",
			filePath: "epoch://year/2025-01-01-2025-12-31",
			date: "2025-01-01",
			source: "epoch",
			epochBucket: "year",
			epochStart: "2025-01-01",
			epochEnd: "2025-12-31",
			groupId: "g1",
			chunkIndex: 0,
			chunkCount: 2,
			createdAt: 1
		});
		const newer = makeJob({
			id: "newer",
			kind: "epoch",
			filePath: "epoch://year/2025-01-01-2025-12-31",
			date: "2025-01-01",
			source: "epoch",
			epochBucket: "year",
			epochStart: "2025-01-01",
			epochEnd: "2025-12-31",
			groupId: "g2",
			chunkIndex: 0,
			chunkCount: 2,
			createdAt: 2
		});

		bridge.enqueue([older]);
		bridge.enqueue([newer]);
		const pending = (bridge as any).pending as AiSummaryJob[];
		expect(pending).toHaveLength(1);
		expect(pending[0]!.id).toBe("newer");
	});

	it("replaces older grouped summary jobs even when targets differ", () => {
		const plugin: any = { settings: {} };
		const bridge = new AiBridgeServer(plugin, () => {});

		const old = makeJob({
			id: "old",
			kind: "cdate",
			filePath: "note.md",
			groupType: "anchor",
			groupDate: "2025-12-27",
			targets: [
				{ kind: "cdate", date: "2025-12-27", blockStart: 0, blockEnd: 1, source: "cdate" }
			],
			createdAt: 1
		});
		const newer = makeJob({
			id: "new",
			kind: "namedDate",
			filePath: "note.md",
			groupType: "anchor",
			groupDate: "2025-12-28",
			targets: [
				{ kind: "namedDate", date: "2025-12-28", blockStart: 2, blockEnd: 3, source: "namedate" },
				{ kind: "content", date: "2025-12-29", blockStart: 4, blockEnd: 5, source: "namedate" }
			],
			createdAt: 2
		});

		bridge.enqueue([old]);
		bridge.enqueue([newer]);

		const pending = (bridge as any).pending as AiSummaryJob[];
		expect(pending).toHaveLength(1);
		expect(pending[0]!.id).toBe("new");
	});
});
