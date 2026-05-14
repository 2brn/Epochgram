import { describe, it, expect, vi } from "vitest";
import { handleBridgeResult } from "../src/plugin/ai-summaries/result-handler";
import { buildEpochContext } from "../src/plugin/ai-summaries/contexts";
import { withTrustedPro } from "./helpers/trusted-pro";

// Ensures epoch jobs can use the same chunk+reduce pipeline as file summaries.

describe("epoch reduce pipeline", () => {
	it("skips failed chunk and still enqueues reduce from successful chunks", () => {
		const index: any = {};
		const plugin: any = {
			indexer: { index },
			settings: { generateEpochs: true },
			hasProAccess: () => true
		};
		withTrustedPro(plugin);

		const enqueue = vi.fn();
		plugin.aiBridge = { enqueue };

		const bucket = "year";
		const start = "2025-01-01";
		const end = "2025-12-31";
		const filePath = `epoch://${bucket}/${start}-${end}`;
		const context = buildEpochContext(bucket as any, start, end);

		const baseJob: any = {
			filePath,
			kind: "epoch",
			date: start,
			blockStart: 0,
			blockEnd: 0,
			source: "epoch",
			inputHash: "h1",
			epochBucket: bucket,
			epochStart: start,
			epochEnd: end,
			context
		};

		handleBridgeResult(
			plugin,
			{ ...baseJob, id: "c0", groupId: "g1", chunkIndex: 0, chunkCount: 2 },
			{ summary: "Chunk topic A" }
		);
		handleBridgeResult(
			plugin,
			{ ...baseJob, id: "c1", groupId: "g1", chunkIndex: 1, chunkCount: 2 },
			{ error: "request failed" }
		);

		expect(enqueue).toHaveBeenCalledTimes(1);
		const reduceJob = enqueue.mock.calls[0]?.[0]?.[0];
		expect(reduceJob).toBeTruthy();
		expect(reduceJob.reduce).toBe(true);
		expect(String(reduceJob.input || "")).toContain("Chunk topic A");
	});

	it("enqueues a reduce job after chunked epoch parts complete, then stores final epoch", () => {
		const index: any = {};
		const plugin: any = {
			indexer: { index },
			settings: { generateEpochs: true },
			hasProAccess: () => true
		};
		withTrustedPro(plugin);

		const enqueue = vi.fn();
		plugin.aiBridge = { enqueue };

		const bucket = "year";
		const start = "2025-01-01";
		const end = "2025-12-31";
		const filePath = `epoch://${bucket}/${start}-${end}`;
		const context = buildEpochContext(bucket as any, start, end);

		const baseJob: any = {
			filePath,
			kind: "epoch",
			date: start,
			blockStart: 0,
			blockEnd: 0,
			source: "epoch",
			inputHash: "h1",
			epochBucket: bucket,
			epochStart: start,
			epochEnd: end,
			context
		};

		handleBridgeResult(
			plugin,
			{ ...baseJob, id: "c0", groupId: "g1", chunkIndex: 0, chunkCount: 2 },
			{ summary: "Chunk topic A" }
		);
		handleBridgeResult(
			plugin,
			{ ...baseJob, id: "c1", groupId: "g1", chunkIndex: 1, chunkCount: 2 },
			{ summary: "Chunk topic B" }
		);

		expect(enqueue).toHaveBeenCalledTimes(1);
		const enqueued = enqueue.mock.calls[0]?.[0];
		expect(Array.isArray(enqueued)).toBe(true);
		expect(enqueued.length).toBe(1);
		const reduceJob = enqueued[0];
		expect(reduceJob.reduce).toBe(true);
		expect(reduceJob.reduceDepth).toBe(1);
		expect(reduceJob.kind).toBe("epoch");

		// Not stored until reduce completes.
		expect(Array.isArray(index[start])).toBe(false);

		handleBridgeResult(plugin, reduceJob, { summary: "FINAL" });

		const stored = Array.isArray(index[start])
			? index[start].find((e: any) => e && e.source === "epoch" && e.epochBucket === bucket)
			: null;
		expect(stored).toBeTruthy();
		expect(String(stored.aiSummary || stored.summary || "")).toContain("FINAL");
	});

	it("treats 'No text provided' as invalid and falls back", () => {
		const index: any = {};
		const plugin: any = {
			indexer: { index },
			settings: { generateEpochs: true },
			hasProAccess: () => true
		};
		withTrustedPro(plugin);

		const enqueue = vi.fn();
		plugin.aiBridge = { enqueue };

		const bucket = "year";
		const start = "2025-01-01";
		const end = "2025-12-31";
		const filePath = `epoch://${bucket}/${start}-${end}`;
		const context = buildEpochContext(bucket as any, start, end);

		const baseJob: any = {
			filePath,
			kind: "epoch",
			date: start,
			blockStart: 0,
			blockEnd: 0,
			source: "epoch",
			inputHash: "h1",
			epochBucket: bucket,
			epochStart: start,
			epochEnd: end,
			context
		};

		handleBridgeResult(
			plugin,
			{ ...baseJob, id: "c0", groupId: "g1", chunkIndex: 0, chunkCount: 2 },
			{ summary: "Chunk topic A" }
		);
		handleBridgeResult(
			plugin,
			{ ...baseJob, id: "c1", groupId: "g1", chunkIndex: 1, chunkCount: 2 },
			{ summary: "Chunk topic B" }
		);

		expect(enqueue).toHaveBeenCalledTimes(1);
		const reduceJob = enqueue.mock.calls[0]?.[0]?.[0];
		expect(reduceJob).toBeTruthy();
		expect(reduceJob.reduce).toBe(true);

		handleBridgeResult(plugin, reduceJob, { summary: "No text provided" });

		const stored = Array.isArray(index[start])
			? index[start].find((e: any) => e && e.source === "epoch" && e.epochBucket === bucket)
			: null;
		expect(stored).toBeTruthy();
		const text = String(stored.aiSummary || stored.summary || "");
		expect(text.toLowerCase()).not.toContain("no text provided");
		expect(text).toContain("Chunk topic");
	});

	it("dedupes duplicate chunk summaries before reduce", () => {
		const index: any = {};
		const plugin: any = {
			indexer: { index },
			settings: { generateEpochs: true },
			hasProAccess: () => true
		};
		withTrustedPro(plugin);

		const enqueue = vi.fn();
		plugin.aiBridge = { enqueue };

		const bucket = "day";
		const start = "2025-01-17";
		const end = "2025-01-17";
		const filePath = `epoch://${bucket}/${start}-${end}`;
		const context = buildEpochContext(bucket as any, start, end);

		const baseJob: any = {
			filePath,
			kind: "epoch",
			date: start,
			blockStart: 0,
			blockEnd: 0,
			source: "epoch",
			inputHash: "h1",
			epochBucket: bucket,
			epochStart: start,
			epochEnd: end,
			context
		};

		handleBridgeResult(
			plugin,
			{ ...baseJob, id: "c0", groupId: "g1", chunkIndex: 0, chunkCount: 2 },
			{ summary: "DUP" }
		);
		handleBridgeResult(
			plugin,
			{ ...baseJob, id: "c1", groupId: "g1", chunkIndex: 1, chunkCount: 2 },
			{ summary: "DUP" }
		);

		expect(enqueue).toHaveBeenCalledTimes(1);
		const reduceJob = enqueue.mock.calls[0]?.[0]?.[0];
		expect(reduceJob).toBeTruthy();
		expect(String(reduceJob.input || "").trim()).toBe("DUP");
	});

	it("dedupes visually-identical duplicate lines before reduce", () => {
		const index: any = {};
		const plugin: any = {
			indexer: { index },
			settings: { generateEpochs: true },
			hasProAccess: () => true
		};
		withTrustedPro(plugin);

		const enqueue = vi.fn();
		plugin.aiBridge = { enqueue };

		const bucket = "day";
		const start = "2025-01-17";
		const end = "2025-01-17";
		const filePath = `epoch://${bucket}/${start}-${end}`;
		const context = buildEpochContext(bucket as any, start, end);

		const baseJob: any = {
			filePath,
			kind: "epoch",
			date: start,
			blockStart: 0,
			blockEnd: 0,
			source: "epoch",
			inputHash: "h1",
			epochBucket: bucket,
			epochStart: start,
			epochEnd: end,
			context
		};

		const attachLineStraight = '"3 - resources/_attachments/file.png"';
		const attachLineSmart = "“3 - resources/_attachments/file.png”";
		const googleStraight = "Google Sheets and script links included";
		const googleWeirdSpaces = "Google\u00A0Sheets  and   script links included";
		const title = "Akūpāra: Mythical Turtle Holding the World";

		handleBridgeResult(
			plugin,
			{ ...baseJob, id: "c0", groupId: "g1", chunkIndex: 0, chunkCount: 2 },
			{ summary: [attachLineStraight, googleStraight, title].join("\n") }
		);
		handleBridgeResult(
			plugin,
			{ ...baseJob, id: "c1", groupId: "g1", chunkIndex: 1, chunkCount: 2 },
			{ summary: [attachLineSmart, googleWeirdSpaces, title].join("\n") }
		);

		expect(enqueue).toHaveBeenCalledTimes(1);
		const reduceJob = enqueue.mock.calls[0]?.[0]?.[0];
		expect(reduceJob).toBeTruthy();
		const input = String(reduceJob.input || "");
		// Attachment line appears only once (quotes normalized for dedupe).
		expect(input.match(/3 - resources\/_attachments\/file\.png/g)?.length ?? 0).toBe(1);
		// Google line appears only once despite whitespace differences.
		expect(input.toLowerCase().match(/google\s+sheets\s+and\s+script\s+links\s+included/g)?.length ?? 0).toBe(1);
		// Title appears only once.
		expect(input.match(/Akūpāra: Mythical Turtle Holding the World/g)?.length ?? 0).toBe(1);
	});

	it("dedupes CR-only line breaks before reduce", () => {
		const index: any = {};
		const plugin: any = {
			indexer: { index },
			settings: { generateEpochs: true },
			hasProAccess: () => true
		};
		withTrustedPro(plugin);

		const enqueue = vi.fn();
		plugin.aiBridge = { enqueue };

		const bucket = "day";
		const start = "2025-01-17";
		const end = "2025-01-17";
		const filePath = `epoch://${bucket}/${start}-${end}`;
		const context = buildEpochContext(bucket as any, start, end);

		const baseJob: any = {
			filePath,
			kind: "epoch",
			date: start,
			blockStart: 0,
			blockEnd: 0,
			source: "epoch",
			inputHash: "h1",
			epochBucket: bucket,
			epochStart: start,
			epochEnd: end,
			context
		};

		const line = "Atacama Skeleton: Discovery of a Possible Early Homo Species";
		handleBridgeResult(
			plugin,
			{ ...baseJob, id: "c0", groupId: "g1", chunkIndex: 0, chunkCount: 2 },
			{ summary: `${line}\r${line}` }
		);
		handleBridgeResult(
			plugin,
			{ ...baseJob, id: "c1", groupId: "g1", chunkIndex: 1, chunkCount: 2 },
			{ summary: "other" }
		);

		expect(enqueue).toHaveBeenCalledTimes(1);
		const reduceJob = enqueue.mock.calls[0]?.[0]?.[0];
		expect(reduceJob).toBeTruthy();
		const input = String(reduceJob.input || "");
		expect(input.split(/\r\n|\n|\r|\u2028|\u2029/g).filter(l => l.trim() === line)).toHaveLength(1);
	});

	it("dedupes invisible Unicode differences before reduce", () => {
		const index: any = {};
		const plugin: any = {
			indexer: { index },
			settings: { generateEpochs: true },
			hasProAccess: () => true
		};
		withTrustedPro(plugin);

		const enqueue = vi.fn();
		plugin.aiBridge = { enqueue };

		const bucket = "year";
		const start = "2013-01-01";
		const end = "2013-12-31";
		const filePath = `epoch://${bucket}/${start}-${end}`;
		const context = buildEpochContext(bucket as any, start, end);

		const baseJob: any = {
			filePath,
			kind: "epoch",
			date: start,
			blockStart: 0,
			blockEnd: 0,
			source: "epoch",
			inputHash: "h1",
			epochBucket: bucket,
			epochStart: start,
			epochEnd: end,
			context
		};

		const line = "Atacama Skeleton: Discovery of a Possible Early Homo Species";
		const withZeroWidth = "Atacama\u200BSkeleton: Discovery of a Possible Early Homo Species";
		const withSoftHyphen = "Atacama\u00ADSkeleton: Discovery of a Possible Early Homo Species";
		const withBidiMark = "Atacama\u200FSkeleton: Discovery of a Possible Early Homo Species";

		handleBridgeResult(
			plugin,
			{ ...baseJob, id: "c0", groupId: "g1", chunkIndex: 0, chunkCount: 2 },
			{ summary: [line, withZeroWidth].join("\n") }
		);
		handleBridgeResult(
			plugin,
			{ ...baseJob, id: "c1", groupId: "g1", chunkIndex: 1, chunkCount: 2 },
			{ summary: [withSoftHyphen, withBidiMark].join("\n") }
		);

		expect(enqueue).toHaveBeenCalledTimes(1);
		const reduceJob = enqueue.mock.calls[0]?.[0]?.[0];
		expect(reduceJob).toBeTruthy();
		const input = String(reduceJob.input || "");
		const INVISIBLE_FORMAT_CHARS_RE = /\u00AD|\u034F|\u061C|\u180E|[\u200B-\u200F]|[\u202A-\u202E]|[\u2060-\u206F]|\uFEFF/g;
		const normalizedLines = input
			.split(/\r\n|\n|\r|\u2028|\u2029/g)
			.map(s => s.replace(INVISIBLE_FORMAT_CHARS_RE, "").trim())
			.filter(Boolean);
		expect(normalizedLines.filter(l => l === line).length).toBe(1);
	});

	it("dedupes duplicate lines within a single chunk summary before reduce", () => {
		const index: any = {};
		const plugin: any = {
			indexer: { index },
			settings: { generateEpochs: true },
			hasProAccess: () => true
		};
		withTrustedPro(plugin);

		const enqueue = vi.fn();
		plugin.aiBridge = { enqueue };

		const bucket = "year";
		const start = "2013-01-01";
		const end = "2013-12-31";
		const filePath = `epoch://${bucket}/${start}-${end}`;
		const context = buildEpochContext(bucket as any, start, end);

		const baseJob: any = {
			filePath,
			kind: "epoch",
			date: start,
			blockStart: 0,
			blockEnd: 0,
			source: "epoch",
			inputHash: "h1",
			epochBucket: bucket,
			epochStart: start,
			epochEnd: end,
			context
		};

		const line = "Atacama Skeleton: Discovery of a Possible Early Homo Species";
		handleBridgeResult(
			plugin,
			{ ...baseJob, id: "c0", groupId: "g1", chunkIndex: 0, chunkCount: 2 },
			{ summary: `${line}\n${line}` }
		);
		handleBridgeResult(
			plugin,
			{ ...baseJob, id: "c1", groupId: "g1", chunkIndex: 1, chunkCount: 2 },
			{ summary: "" }
		);

		expect(enqueue).toHaveBeenCalledTimes(1);
		const reduceJob = enqueue.mock.calls[0]?.[0]?.[0];
		expect(reduceJob).toBeTruthy();
		const input = String(reduceJob.input || "");
		expect(input.split(/\r\n|\n|\r|\u2028|\u2029/g).filter(l => l.trim() === line)).toHaveLength(1);
	});
});
