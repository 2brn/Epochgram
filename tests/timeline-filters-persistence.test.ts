import { describe, expect, it, vi } from "vitest";

import {
	epochViewSetReviewFilterMode,
	epochViewSetShowAttachments,
	epochViewSetShowContentDates,
	epochViewSetShowEpochsView,
	epochViewSetShowPropDates,
	epochViewSetShowTrackedChanges
} from "../src/ui/epoch-view/filters";

function createView(overrides: Record<string, any> = {}): any {
	const plugin: any = {
		settings: {
			timelineFilters: {},
			parseDatesInFrontmatter: false
		},
		viewPreferences: {},
		saveSettings: vi.fn(async () => {})
	};

	const canvas: any = {
		setReviewFilterMode: vi.fn(),
		setShowAttachments: vi.fn(),
		setShowTrackedChanges: vi.fn(),
		setShowContentDates: vi.fn(),
		setShowPropDates: vi.fn(),
		setEpochsView: vi.fn()
	};

	const view: any = {
		plugin,
		canvas,
		reviewFilterMode: "reviewed+draft",
		showAttachments: false,
		showTrackedChanges: true,
		showContentDates: true,
		showPropDates: false,
		showEpochsView: false,
		isPro: () => true,
		isEpochsEnabled: () => true,
		hasSyncedEpochEntries: true,
		refreshSyncedEpochAvailability: vi.fn(),
		scheduleSearchControlRefresh: vi.fn(),
		...overrides
	};

	return view;
}

describe("timeline filters persistence", () => {
	it("persists supported filters into settings.timelineFilters", () => {
		const view = createView({ showAttachments: false, showTrackedChanges: false });

		epochViewSetReviewFilterMode(view, "draft");
		epochViewSetShowAttachments(view, true);
		epochViewSetShowTrackedChanges(view, true);

		expect(view.plugin.settings.timelineFilters.showDraftsOnly).toBe(true);
		expect(view.plugin.settings.timelineFilters.showAttachments).toBe(true);
		expect(view.plugin.settings.timelineFilters.showTrackedChanges).toBe(true);
		expect(view.plugin.saveSettings).toHaveBeenCalled();
	});

	it("does not persist session-only filters (epochs view)", () => {
		const view = createView();
		epochViewSetShowEpochsView(view, true);

		expect(view.plugin.settings.timelineFilters.showEpochsView).toBeUndefined();
		// may have been called by other persisted setters, but these two should not trigger it.
		expect(view.plugin.saveSettings).toHaveBeenCalledTimes(0);
	});

	it("enforces parsed/frontmatter nesting when persisting", () => {
		const view = createView({
			showContentDates: false,
			showPropDates: false,
			plugin: {
				settings: {
					timelineFilters: {},
					parseDatesInFrontmatter: true
				},
				viewPreferences: {},
				saveSettings: vi.fn(async () => {})
			}
		});

		epochViewSetShowPropDates(view, true);
		expect(view.showContentDates).toBe(true);
		expect(view.showPropDates).toBe(true);
		expect(view.plugin.settings.timelineFilters.showParsed).toBe(true);

		view.plugin.saveSettings.mockClear();
		epochViewSetShowContentDates(view, false);
		expect(view.showContentDates).toBe(false);
		expect(view.showPropDates).toBe(false);
		expect(view.plugin.settings.timelineFilters.showParsed).toBe(false);
		expect(view.plugin.saveSettings).toHaveBeenCalledTimes(1);
	});
});
