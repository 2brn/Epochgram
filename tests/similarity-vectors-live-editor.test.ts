import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";

const state = vi.hoisted(() => {
	return {
		lastChunks: [] as string[]
	};
});

const embedPooledChunksMock = vi.hoisted(() => {
	return vi.fn(async (_plugin: any, _modelId: string, chunks: string[]) => {
		state.lastChunks = chunks;
		return [1, 2, 3];
	});
});

const getPreferredSimilarityTextMock = vi.hoisted(() => {
	return vi.fn(() => "OLD SUMMARY");
});

vi.mock("../src/plugin/similarity/worker-embed", () => {
	return {
		embedPooledChunks: embedPooledChunksMock
	};
});

vi.mock("../src/plugin/similarity/text", async () => {
	const actual = await vi.importActual<any>("../src/plugin/similarity/text");
	return {
		...actual,
		getPreferredSimilarityText: getPreferredSimilarityTextMock
	};
});

import { buildNoteVector } from "../src/plugin/similarity/vectors-build";

const makeFile = (path: string): TFile => {
	const name = path.split("/").pop() ?? path;
	const extension = name.includes(".") ? name.split(".").pop() ?? "" : "";
	const basename = extension ? name.slice(0, -(extension.length + 1)) : name;
	const Ctor = TFile as unknown as new (path: string, options?: Partial<TFile>) => TFile;
	return new Ctor(path, {
		basename,
		extension,
		stat: {
			ctime: Date.UTC(2025, 0, 1),
			mtime: Date.UTC(2025, 0, 1),
			size: 0
		}
	});
};

describe("buildNoteVector live editor priority", () => {
	it("uses active editor buffer over preferred similarity text", async () => {
		const file = makeFile("note.md");
		const vaultRead = vi.fn(async () => "DISK CONTENT");
		const pluginStub: any = {
			shouldIndexFile: () => true,
			app: {
				vault: {
					read: vaultRead
				},
				workspace: {
					getActiveViewOfType: vi.fn(() => {
						return {
							file,
							editor: {
								getValue: () => "---\nfoo: bar\n---\nNEW BODY"
							}
						};
					})
				}
			}
		};

		state.lastChunks = [];
		embedPooledChunksMock.mockClear();
		getPreferredSimilarityTextMock.mockClear();

		const out = await buildNoteVector(pluginStub, file, "test-model");
		expect(out?.vector).toEqual([1, 2, 3]);

		expect(getPreferredSimilarityTextMock).not.toHaveBeenCalled();
		expect(vaultRead).not.toHaveBeenCalled();
		expect(embedPooledChunksMock).toHaveBeenCalledTimes(1);
		expect(state.lastChunks.length).toBeGreaterThan(0);
		expect(state.lastChunks[0]).toContain("NEW BODY");
		expect(state.lastChunks[0]).not.toContain("OLD SUMMARY");
		expect(state.lastChunks[0]).not.toContain("---");
	});
});
