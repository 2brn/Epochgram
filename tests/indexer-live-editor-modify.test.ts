import { beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { Indexer } from "../src/indexer/indexer";
import { computeTextHash } from "../src/utils";
import { normalizeSnapshotValue } from "../src/indexer/snapshot-helpers";

describe("Indexer live editor for modify", () => {
	let indexer: Indexer;
	let pluginStub: any;

	beforeEach(() => {
		pluginStub = {
			settings: {
				trackChanges: false,
				summaryWordsCount: 8
			},
			hasProAccess: () => true,
			app: {
				vault: {
					read: vi.fn(async () => "DISK CONTENT")
				},
				workspace: {
					getActiveViewOfType: vi.fn()
				}
			}
		};
		indexer = new Indexer(pluginStub);
	});

	const makeFile = (path: string, ctime: number): TFile => {
		const name = path.split("/").pop() ?? path;
		const extension = name.includes(".") ? name.split(".").pop() ?? "" : "";
		const basename = extension ? name.slice(0, -(extension.length + 1)) : name;
		const Ctor = TFile as unknown as new (
			path: string,
			options?: Partial<TFile>
		) => TFile;
		return new Ctor(path, {
			basename,
			extension,
			stat: {
				ctime,
				mtime: ctime,
				size: 0
			}
		});
	};

	it("prefers active editor buffer for modify reason", async () => {
		const ctime = Date.UTC(2026, 4, 5);
		const file = makeFile("notes/A.md", ctime);
		const liveContent = "Live body with [[B]]";

		pluginStub.app.workspace.getActiveViewOfType.mockReturnValue({
			file,
			editor: {
				getValue: () => liveContent
			}
		});

		await indexer.processFile(file, { reason: "modify" });

		expect(pluginStub.app.vault.read).not.toHaveBeenCalled();
		const data = (indexer as any).files[file.path];
		expect(data).toBeTruthy();
		expect(data.contentHash).toBe(computeTextHash(normalizeSnapshotValue(liveContent) ?? ""));
		expect(data.contentHash).not.toBe(computeTextHash(normalizeSnapshotValue("DISK CONTENT") ?? ""));
	});
});
