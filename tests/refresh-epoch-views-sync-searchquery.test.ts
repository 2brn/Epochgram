import { describe, it, expect, vi } from "vitest";
import { refreshEpochViews } from "../src/plugin/view/leaf-actions";
describe("refreshEpochViews", () => {
	it.each([false, true])("refreshes related highlights without overwriting session search (force=%s)", force => {
		const view: any = { syncPreferencesFromPlugin: vi.fn(), refreshIndex: vi.fn(), canvas: { refreshRelatedForActiveFile: vi.fn() } };
		const plugin: any = { indexReady: true, viewPreferences: { showAttachments: false, showParsed: true }, app: { workspace: { getLeavesOfType: () => [{ view }] } } };
		refreshEpochViews(plugin, { forceRelated: force });
		expect(view.syncSearchQueryFromPlugin).toBeUndefined();
		expect(view.canvas.refreshRelatedForActiveFile).toHaveBeenCalledExactlyOnceWith(force);
		expect(view.refreshIndex).toHaveBeenCalledOnce();
	});
});
