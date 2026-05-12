import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { dailyNoteMethods } from "../src/plugin/daily-notes";

describe("daily note template location", () => {
	it("reads template path from Daily Notes core settings", () => {
		const plugin: any = {
			app: {
				internalPlugins: {
					getPluginById: (id: string) => id === "daily-notes"
						? {
							enabled: true,
							instance: {
								options: {
									template: " Templates\\Daily.md ",
									folder: "",
									format: "YYYY-MM-DD"
								}
							}
						}
						: null
				}
			}
		};
		expect(dailyNoteMethods.getDailyNoteTemplatePath.call(plugin)).toBe("Templates/Daily.md");
	});

	it("renders title/date/time placeholders from template content", async () => {
		const templateFile = new (TFile as any)("Templates/Daily.md");
		const date = new Date(2026, 2, 14, 9, 5, 6, 7);
		const plugin: any = {
			app: {
				vault: {
					getAbstractFileByPath: (path: string) => path === "Templates/Daily.md" ? templateFile : null,
					cachedRead: vi.fn(async () => "# {{title}}\n{{date}}\n{{date:YYYY/MM/DD}}\n{{time:HH:mm}}\n{{yesterday:YYYY-MM-DD}}\n{{tomorrow:YYYY-MM-DD}}")
				},
				internalPlugins: {
					getPluginById: (id: string) => id === "daily-notes"
						? {
							enabled: true,
							instance: {
								options: {
									template: "Templates/Daily.md",
									folder: "",
									format: "YYYY-MM-DD"
								}
							}
						}
						: null
				}
			}
		};

		const content = await dailyNoteMethods.getDailyNoteTemplateContent.call(plugin, date, "Daily/2026-03-14 (2).md");

		expect(content).toContain("# 2026-03-14 (2)");
		expect(content).toContain("2026-03-14");
		expect(content).toContain("2026/03/14");
		expect(content).toContain("09:05");
		expect(content).toContain("2026-03-13");
		expect(content).toContain("2026-03-15");
	});

	it("resolves template path without .md extension", async () => {
		const templateFile = new (TFile as any)("3 - resources/_templates/default.md");
		const date = new Date(2026, 2, 14, 9, 5, 6, 7);
		const plugin: any = {
			app: {
				vault: {
					getAbstractFileByPath: (path: string) => path === "3 - resources/_templates/default.md" ? templateFile : null,
					cachedRead: vi.fn(async () => "{{title}}")
				},
				internalPlugins: {
					getPluginById: (id: string) => id === "daily-notes"
						? {
							enabled: true,
							instance: {
								options: {
									template: "3 - resources/_templates/default",
									folder: "",
									format: "YYYY-MM-DD"
								}
							}
						}
						: null
				}
			}
		};

		const content = await dailyNoteMethods.getDailyNoteTemplateContent.call(plugin, date, "0 - draft/2026-03-14.md");

		expect(content).toBe("2026-03-14");
	});

	it("returns null when template path is missing", async () => {
		const plugin: any = {
			app: {
				vault: {
					getAbstractFileByPath: () => null
				},
				internalPlugins: {
					getPluginById: (id: string) => id === "daily-notes"
						? {
							enabled: true,
							instance: {
								options: {
									folder: "",
									format: "YYYY-MM-DD"
								}
							}
						}
						: null
				}
			}
		};

		const content = await dailyNoteMethods.getDailyNoteTemplateContent.call(plugin, new Date(2026, 2, 14), "2026-03-14.md");
		expect(content).toBeNull();
	});
});
