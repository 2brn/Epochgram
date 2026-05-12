import { describe, expect, it } from "vitest";

import { SUMMARY_ENTRY_SEPARATOR } from "../src/ui/epoch-canvas-constants";
import { formatEntrySummary } from "../src/ui/epoch-canvas-utils";

describe("formatEntrySummary filenameWordsCount", () => {
	it("renders note ⸱ summary by default (no filenameWordsCount)", () => {
		const entry: any = {
			file: "folder/note.md",
			source: "content",
			summary: "hello"
		};
		const out = formatEntrySummary(entry, { fallbackToFileName: true, includeIcons: false });
		expect(out).toBe(`note${SUMMARY_ENTRY_SEPARATOR}hello`);
	});

	it("renders summary only when filenameWordsCount is 0", () => {
		const entry: any = {
			file: "folder/note.md",
			source: "content",
			summary: "hello"
		};
		const out = formatEntrySummary(entry, {
			fallbackToFileName: true,
			includeIcons: false,
			filenameWordsCount: 0
		});
		expect(out).toBe("hello");
	});

	it("always falls back to filename when no summary", () => {
		const entry: any = {
			file: "folder/note.md",
			source: "content",
			summary: ""
		};
		const out = formatEntrySummary(entry, {
			fallbackToFileName: true,
			includeIcons: false,
			filenameWordsCount: 0
		});
		expect(out).toBe("note");
	});

	it("does not duplicate note name when summary matches note name", () => {
		const entry: any = {
			file: "folder/note.md",
			source: "content",
			summary: "note"
		};
		const out = formatEntrySummary(entry, {
			fallbackToFileName: true,
			includeIcons: false,
			filenameWordsCount: 3
		});
		expect(out).toBe("note");
	});

	it("truncates filename to specified word count with ellipsis, excluding punctuation", () => {
		const entry: any = {
			file: "folder/My Very Long Name.md",
			source: "content",
			summary: "hello"
		};
		const out = formatEntrySummary(entry, {
			fallbackToFileName: true,
			includeIcons: false,
			filenameWordsCount: 3
		});
		expect(out).toBe(`My Very Long...${SUMMARY_ENTRY_SEPARATOR}hello`);
	});

	it("does not truncate filename when word count is sufficient", () => {
		const entry: any = {
			file: "folder/Short Name.md",
			source: "content",
			summary: "hello"
		};
		const out = formatEntrySummary(entry, {
			fallbackToFileName: true,
			includeIcons: false,
			filenameWordsCount: 3
		});
		expect(out).toBe(`Short Name${SUMMARY_ENTRY_SEPARATOR}hello`);
	});

	it("counts only alphanumeric tokens as words (excludes punctuation)", () => {
		const entry: any = {
			file: "folder/Epochgram - To Do.md",
			source: "content",
			summary: "hello"
		};
		const out = formatEntrySummary(entry, {
			fallbackToFileName: true,
			includeIcons: false,
			filenameWordsCount: 3
		});
		expect(out).toBe(`Epochgram - To Do${SUMMARY_ENTRY_SEPARATOR}hello`);
	});

	it("truncates Cyrillic filename with punctuation when word limit is reached", () => {
		const entry: any = {
			file: "folder/Obsidian - Екзистенційне питання.md",
			source: "content",
			summary: "hello"
		};
		const out = formatEntrySummary(entry, {
			fallbackToFileName: true,
			includeIcons: false,
			filenameWordsCount: 2
		});
		expect(out).toBe(`Obsidian Екзистенційне...${SUMMARY_ENTRY_SEPARATOR}hello`);
	});

	it("truncates all-Cyrillic filename with punctuation when word limit is reached", () => {
		const entry: any = {
			file: "folder/Сон - Набір фільтрів до камер.md",
			source: "content",
			summary: "hello"
		};
		const out = formatEntrySummary(entry, {
			fallbackToFileName: true,
			includeIcons: false,
			filenameWordsCount: 2
		});
		expect(out).toBe(`Сон Набір...${SUMMARY_ENTRY_SEPARATOR}hello`);
	});

	it("truncates filename when summaryWordsCount is 0 but filenameWordsCount is set", () => {
		const entry: any = {
			file: "folder/My Very Long Filename Here.md",
			source: "content",
			summary: ""
		};
		const out = formatEntrySummary(entry, {
			fallbackToFileName: true,
			includeIcons: false,
			filenameWordsCount: 2,
			summaryWordsCount: 0
		});
		expect(out).toBe("My Very...");
	});

	it("truncates Cyrillic filename when summaryWordsCount is 0 but filenameWordsCount is set", () => {
		const entry: any = {
			file: "folder/Сон - Набір фільтрів до камер.md",
			source: "content",
			summary: ""
		};
		const out = formatEntrySummary(entry, {
			fallbackToFileName: true,
			includeIcons: false,
			filenameWordsCount: 2,
			summaryWordsCount: 0
		});
		expect(out).toBe("Сон Набір...");
	});

	it("shows full filename when both filenameWordsCount and summaryWordsCount are 0", () => {
		const entry: any = {
			file: "folder/My Very Long Filename Here.md",
			source: "content",
			summary: "summary text here"
		};
		const out = formatEntrySummary(entry, {
			fallbackToFileName: true,
			includeIcons: false,
			filenameWordsCount: 0,
			summaryWordsCount: 0
		});
		expect(out).toBe("My Very Long Filename Here");
	});

	it("truncates filename and hides summary when summaryWordsCount is 0 and filenameWordsCount is set", () => {
		const entry: any = {
			file: "folder/My Very Long Filename Here.md",
			source: "content",
			summary: "hello world this is summary"
		};
		const out = formatEntrySummary(entry, {
			fallbackToFileName: true,
			includeIcons: false,
			filenameWordsCount: 2,
			summaryWordsCount: 0
		});
		// When summaryWordsCount is 0, summary is hidden but filename is still truncated per filenameWordsCount
		expect(out).toBe("My Very...");
	});

	it("shows filename when summaryWordsCount=0 with long summary text", () => {
		const entry: any = {
			file: "folder/First Second Third Fourth Fifth.md",
			source: "content",
			summary: "This is a very long summary that should be completely hidden when summaryWordsCount is 0"
		};
		const out = formatEntrySummary(entry, {
			fallbackToFileName: true,
			includeIcons: false,
			filenameWordsCount: 2,
			summaryWordsCount: 0
		});
		expect(out).toBe("First Second...");
	});

	it("shows only filename (no separator) when summaryWordsCount=0", () => {
		const entry: any = {
			file: "folder/My Note Name.md",
			source: "content",
			summary: "A summary that should not appear"
		};
		const out = formatEntrySummary(entry, {
			fallbackToFileName: true,
			includeIcons: false,
			filenameWordsCount: 3,
			summaryWordsCount: 0
		});
		expect(out).toBe("My Note Name");
	});

	it("truncates filename when summaryWordsCount=0 and file has no summary", () => {
		const entry: any = {
			file: "folder/One Two Three Four Five.md",
			source: "content",
			summary: ""
		};
		const out = formatEntrySummary(entry, {
			fallbackToFileName: true,
			includeIcons: false,
			filenameWordsCount: 2,
			summaryWordsCount: 0
		});
		expect(out).toBe("One Two...");
	});

	it("truncates Cyrillic filename with punctuation and spaces when summaryWordsCount=0 and filenameWordsCount>0", () => {
		const entry: any = {
			file: "folder/  Сон - Набір, фільтрів! до камер.md",
			source: "content",
			summary: "Це має бути приховано, якщо summaryWordsCount=0"
		};
		const out = formatEntrySummary(entry, {
			fallbackToFileName: true,
			includeIcons: false,
			filenameWordsCount: 2,
			summaryWordsCount: 0
		});
		expect(out).toBe("Сон Набір...");
	});

	it("truncates Greek filename when summaryWordsCount=0 and filenameWordsCount>0", () => {
		const entry: any = {
			file: "folder/  Αθήνα - Παρθενώνας, Ακρόπολη! Ελλάδα.md",
			source: "content",
			summary: "Αυτό πρέπει να είναι κρυφό αν summaryWordsCount=0"
		};
		const out = formatEntrySummary(entry, {
			fallbackToFileName: true,
			includeIcons: false,
			filenameWordsCount: 2,
			summaryWordsCount: 0
		});
		expect(out).toBe("Αθήνα Παρθενώνας...");
	});

	it("truncates Arabic filename when summaryWordsCount=0 and filenameWordsCount>0", () => {
		const entry: any = {
			file: "folder/  القاهرة - الأهرام، مصر! نيل.md",
			source: "content",
			summary: "يجب أن يكون هذا مخفيًا إذا كان summaryWordsCount=0"
		};
		const out = formatEntrySummary(entry, {
			fallbackToFileName: true,
			includeIcons: false,
			filenameWordsCount: 2,
			summaryWordsCount: 0
		});
		expect(out).toBe("القاهرة الأهرام...");
	});

	it("truncates Chinese filename when summaryWordsCount=0 and filenameWordsCount>0", () => {
		const entry: any = {
			file: "folder/  北京 - 紫禁城, 故宫! 中国.md",
			source: "content",
			summary: "如果 summaryWordsCount=0，这应该被隐藏"
		};
		const out = formatEntrySummary(entry, {
			fallbackToFileName: true,
			includeIcons: false,
			filenameWordsCount: 2,
			summaryWordsCount: 0
		});
		expect(out).toBe("北京 紫禁城...");
	});

	it("truncates Japanese filename when summaryWordsCount=0 and filenameWordsCount>0", () => {
		const entry: any = {
			file: "folder/  東京 - 皇居, 日本! 桜.md",
			source: "content",
			summary: "summaryWordsCount=0 の場合、これは非表示にする必要があります"
		};
		const out = formatEntrySummary(entry, {
			fallbackToFileName: true,
			includeIcons: false,
			filenameWordsCount: 2,
			summaryWordsCount: 0
		});
		expect(out).toBe("東京 皇居...");
	});

	it("truncates Cyrillic filename to 1 word when summaryWordsCount=0 and filenameWordsCount=1", () => {
		const entry: any = {
			file: "folder/Сон - Набір фільтрів до камер.md",
			source: "content",
			summary: "Це має бути приховано, якщо summaryWordsCount=0"
		};
		const out = formatEntrySummary(entry, {
			fallbackToFileName: true,
			includeIcons: false,
			filenameWordsCount: 1,
			summaryWordsCount: 0
		});
		expect(out).toBe("Сон...");
	});

	it("truncates when summary equals filename (isFallbackSummary case, SCP)", () => {
		const entry: any = {
			file: "folder/SCP - Containment Breach.md",
			source: "content",
			summary: "SCP - Containment Breach"
		};
		const out = formatEntrySummary(entry, {
			fallbackToFileName: true,
			includeIcons: false,
			filenameWordsCount: 1,
			summaryWordsCount: 0
		});
		expect(out).toBe("SCP...");
	});

	it("truncates Cyrillic filename when summary equals filename (isFallbackSummary case)", () => {
		const entry: any = {
			file: "folder/Obsidian - Екзистенційне питання.md",
			source: "content",
			summary: "Obsidian - Екзистенційне питання"
		};
		const out = formatEntrySummary(entry, {
			fallbackToFileName: true,
			includeIcons: false,
			filenameWordsCount: 1,
			summaryWordsCount: 0
		});
		expect(out).toBe("Obsidian...");
	});

	it("truncates all-caps filename when summary equals filename (sameAsPrefix, summaryWordsCount=1)", () => {
		const entry: any = {
			file: "folder/CANCEL ADOBE SUBSCRIPTION!.md",
			source: "content",
			summary: "CANCEL ADOBE SUBSCRIPTION!"
		};
		const out = formatEntrySummary(entry, {
			fallbackToFileName: true,
			includeIcons: false,
			filenameWordsCount: 1,
			summaryWordsCount: 1
		});
		expect(out).toBe("CANCEL...");
	});

	it("truncates Cyrillic filename when summary equals filename (sameAsPrefix)", () => {
		const entry: any = {
			file: "folder/Сон - Набір фільтрів до камер.md",
			source: "content",
			summary: "Сон - Набір фільтрів до камер"
		};
		const out = formatEntrySummary(entry, {
			fallbackToFileName: true,
			includeIcons: false,
			filenameWordsCount: 1,
			summaryWordsCount: 1
		});
		expect(out).toBe("Сон...");
	});

	it("truncates long filename when summary equals filename (sameAsPrefix, summaryWordsCount=1)", () => {
		const entry: any = {
			file: "folder/Some very - long file of the same build of the github which I would like to use.md",
			source: "content",
			summary: "Some very - long file of the same build of the github which I would like to use"
		};
		const out = formatEntrySummary(entry, {
			fallbackToFileName: true,
			includeIcons: false,
			filenameWordsCount: 1,
			summaryWordsCount: 1
		});
		expect(out).toBe("Some...");
	});

	it("re-truncates filename prefix when summary is already prefixed with full filename", () => {
		const entry: any = {
			file: "folder/SCP - Containment Breach.md",
			source: "content",
			summary: `SCP - Containment Breach${SUMMARY_ENTRY_SEPARATOR}actual summary text`
		};
		const out = formatEntrySummary(entry, {
			fallbackToFileName: true,
			includeIcons: false,
			filenameWordsCount: 1,
			summaryWordsCount: 1
		});
		expect(out).toBe(`SCP...${SUMMARY_ENTRY_SEPARATOR}actual...`);
	});

	it("truncates tracked summary to one word when summaryWordsCount=1", () => {
		const entry: any = {
			file: "folder/Epochgram - Reddit.md",
			source: "tracked",
			trackedChange: "modified",
			summary: "How do you guys find related notes"
		};
		const out = formatEntrySummary(entry, {
			fallbackToFileName: true,
			includeIcons: false,
			filenameWordsCount: 1,
			summaryWordsCount: 1
		});
		expect(out).toBe(`Epochgram...${SUMMARY_ENTRY_SEPARATOR}How...`);
	});

	it("truncates tracked Cyrillic summary to one word when summaryWordsCount=1", () => {
		const entry: any = {
			file: "folder/Obsidian - Екзистенційне питання.md",
			source: "tracked",
			trackedChange: "modified",
			summary: "Працює на десктопі і мобайлі Дозволяє побачити"
		};
		const out = formatEntrySummary(entry, {
			fallbackToFileName: true,
			includeIcons: false,
			filenameWordsCount: 1,
			summaryWordsCount: 1
		});
		expect(out).toBe(`Obsidian...${SUMMARY_ENTRY_SEPARATOR}Працює...`);
	});

	it("truncates tracked uppercase summary to one word when summaryWordsCount=1", () => {
		const entry: any = {
			file: "folder/SCP - Containment Breach.md",
			source: "tracked",
			trackedChange: "modified",
			summary: "MAV CMD GUIDED CHANGE SPEED MAV CMD"
		};
		const out = formatEntrySummary(entry, {
			fallbackToFileName: true,
			includeIcons: false,
			filenameWordsCount: 1,
			summaryWordsCount: 1
		});
		expect(out).toBe(`SCP...${SUMMARY_ENTRY_SEPARATOR}MAV...`);
	});
});
