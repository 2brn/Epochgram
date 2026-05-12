import { describe, expect, it } from "vitest";

import { EpochView } from "../src/ui/epoch-view";

describe("Epochs view availability", () => {
	it("does not clear availability when index is temporarily empty", () => {
		const view: any = {
			hasSyncedEpochEntries: true,
			plugin: { indexer: { index: {} } }
		};
		(EpochView as any).prototype.refreshSyncedEpochAvailability.call(view);
		expect(view.hasSyncedEpochEntries).toBe(true);
	});

	it("does not clear availability when index has only empty lists", () => {
		const view: any = {
			hasSyncedEpochEntries: true,
			plugin: { indexer: { index: { "2026-02-19": [] } } }
		};
		(EpochView as any).prototype.refreshSyncedEpochAvailability.call(view);
		expect(view.hasSyncedEpochEntries).toBe(true);
	});

	it("clears availability when index has entries but no epochs", () => {
		const view: any = {
			hasSyncedEpochEntries: true,
			plugin: {
				indexer: {
					index: {
						"2026-02-19": [
							{ file: "A.md", source: "content" },
							{ file: "B.md", source: "tracked" }
						]
					}
				}
			}
		};
		(EpochView as any).prototype.refreshSyncedEpochAvailability.call(view);
		expect(view.hasSyncedEpochEntries).toBe(false);
	});

	it("sets availability when an epoch entry exists", () => {
		const view: any = {
			hasSyncedEpochEntries: false,
			plugin: {
				indexer: {
					index: {
						"2026-02-19": [
							{ file: "epoch://month/2026-02-01-2026-02-29", source: "epoch" }
						]
					}
				}
			}
		};
		(EpochView as any).prototype.refreshSyncedEpochAvailability.call(view);
		expect(view.hasSyncedEpochEntries).toBe(true);
	});
});
