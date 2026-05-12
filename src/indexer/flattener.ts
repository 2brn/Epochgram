import { SUMMARY_SEPARATOR_SYMBOL } from "../ui/epoch-canvas-constants";

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function flattenForDates(raw: string): string {
	if (!raw) return "";

	let text = raw;

	// Remove YAML frontmatter at the start (supports BOM and Windows newlines)
	text = text.replace(/^[\uFEFF]?---\r?\n[\s\S]*?\r?\n---\r?\n?/m, " ");

	return text
		// Obsidian comments
		.replace(/%%[\s\S]*?%%/g, " ")

		// HTML comments
		.replace(/<!--[\s\S]*?-->/g, " ")

		// <style>...</style> and <script>...</script> — drop content
		.replace(/<style[\s\S]*?<[/]style>/gi, " ")
		.replace(/<script[\s\S]*?<[/]script>/gi, " ")

		// <a href="...">text</a> → keep inner text only
		.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, " $1 ")

		// <img> / <iframe> → drop
		.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, " ")
		.replace(/<img\b[^>]*\/?>/gi, " ")

		// HTML tags — strip tags, keep text
		.replace(/<[^>]+>/g, " ")

		// HTML entities
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&apos;/gi, "'")
		.replace(/&nbsp;|&#160;/gi, " ")
		.replace(/&#\d+;/g, " ")
		.replace(/&[a-z]+;/gi, " ")

		// ``` fenced code ```
		.replace(/```[\s\S]*?```/g, " ")

		// inline code
		.replace(/`[^`]*`/g, " ")

		// images ![[...]]
		.replace(/!\[\[.*?]]/g, " ")

		// wiki links [[...]]
		.replace(/\[\[[^\]]+]]/g, " ")

		// markdown links [text](url)
		.replace(/\[[^\]]*]\([^)]*\)/g, " ")

		// raw URLs
		.replace(/https?:[/][/]\S+/g, " ")

		// images ![](url)
		.replace(/!\[[^\]]*]\([^)]*\)/g, " ")

		// tags #tag
		.replace(/(^|\s)#[\p{L}\p{N}_/-]+/gu, " ")

		// headings
		.replace(/#+\s+/g, " ")

		// blockquotes >
		.replace(/^\s*>+\s?/gm, " ")

		// lists
		.replace(/^\s*[-*+]\s+/gm, " ")

		// formatting
		.replace(/\*\*/g, " ")
		.replace(/[*_]/g, " ")

		// newlines
		.replace(/\r?\n/g, " ")

		// collapse
		.replace(/\s+/g, " ")
		.trim();
}

export function flattenForSummary(raw: string): string {
	if (!raw) return "";

	const LINK_MAX = 20;
	const dateTokens: string[] = [];
	const protectDate = (match: string) => {
		const id = dateTokens.length;
		dateTokens.push(match);
		return `DATETOKEN${id}`;
	};

	const cleanUrl = (url: string): string => {
		let u = url.trim()
			.replace(/^(https?:[/][/])/i, "")
			.replace(/^www\./i, "");

		let hadQuery = false;
		if (u.includes("?")) {
			hadQuery = true;
			u = u.replace(/\?.*$/, "");
		}

		u = u.replace(/[/]$/, "");
		if (hadQuery) return u + "...";
		return u.length > LINK_MAX ? u.slice(0, LINK_MAX) + "..." : u;
	};

	const pushUrlPlaceholder = (url: string): string | null => {
		const cleaned = cleanUrl(url).trim();
		if (!cleaned || !/[^.\s]/.test(cleaned)) return null;
		const ph = `URLPH${urls.length}TOKEN`;
		urls.push(cleaned);
		return ph;
	};

	let text = raw;
	const urls: string[] = [];
	const files: string[] = [];
	const taskMarkers: string[] = [];
	const summarySeparators: string[] = [];
	const summarySeparatorToken = (index: number) => `SUMMARYSEP${index}TOKEN`;

	if (SUMMARY_SEPARATOR_SYMBOL) {
		const summaryRegex = new RegExp(escapeRegex(SUMMARY_SEPARATOR_SYMBOL), "g");
		text = text.replace(summaryRegex, () => {
			const id = summarySeparators.length;
			summarySeparators.push(SUMMARY_SEPARATOR_SYMBOL);
			return summarySeparatorToken(id);
		});
	}

	// YAML frontmatter
	text = text.replace(/^---[\s\S]*?---\s*/m, " ");

	// Protect backslash-escaped formatting characters: \* \_ \~ \= etc.
	// The backslash is dropped in the output; the literal character is preserved.
	const escapedChars: string[] = [];
	text = text.replace(/\\([*_~=`![\]#>|\\])/g, (_, ch) => {
		const id = escapedChars.length;
		escapedChars.push(String(ch));
		return `ESCCHAR${id}TOKEN`;
	});

	// HTML anchors: <a href="...">text</a> → LNKARROW text (url)
	text = text.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_, attrs, label) => {
		const hrefMatch = /href=['"]?([^'"\s>]+)['"]?/i.exec(attrs);
		const innerText = label.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
		if (!hrefMatch) return innerText || " ";
		const ph = pushUrlPlaceholder(hrefMatch[1]);
		if (innerText && ph) return "LNKARROW " + `${innerText} (${ph})`;
		if (innerText) return innerText;
		if (ph) return "LNKARROW " + ph;
		return " ";
	});

	// HTML img: <img src="..." alt="..."> → LNKARROW [alt ]url
	text = text.replace(/<img\b([^>]*)\/?>/gi, (_, attrs) => {
		const srcMatch = /src=['"]?([^'"\s>]+)['"]?/i.exec(attrs);
		if (!srcMatch) return " ";
		const ph = pushUrlPlaceholder(srcMatch[1]);
		const altMatch = /alt=['"]([^'"]+)['"]/i.exec(attrs);
		const alt = altMatch ? altMatch[1].trim() : "";
		if (alt && ph) return "LNKARROW " + `${alt} (${ph})`;
		if (alt) return alt;
		if (ph) return "LNKARROW " + ph;
		return " ";
	});

	// HTML iframe: <iframe src="...">...</iframe> → LNKARROW url
	text = text.replace(/<iframe\b([^>]*)>[\s\S]*?<\/iframe>/gi, (_, attrs) => {
		const srcMatch = /src=['"]?([^'"\s>]+)['"]?/i.exec(attrs);
		if (!srcMatch) return " ";
		const ph = pushUrlPlaceholder(srcMatch[1]);
		return ph ? "LNKARROW " + ph : " ";
	});

	// quotes but keep content
	text = text.replace(/"([^"]+)"|'([^']+)'/g, (_, a, b) => a || b);

	// Obsidian embeds: keep filename (strip leading path, keep base name)
	text = text.replace(/!\[\[([^\]]+?)]]/g, (_, fname) => {
		const base = String(fname ?? "").split("/").pop() ?? fname;
		const label = String(base || "").trim();
		return label ? "LNKARROW " + label : " ";
	});

	// Wiki links
	text = text.replace(/\[\[([^\]]+?)]]/g, (_, inner) => {
		const label = String(inner || "").trim();
		return label ? "LNKARROW " + label : " ";
	});

	// Markdown links
	text = text.replace(/\[([^\]]*)]\(([^)]*)\)/g, (_, label, url) => {
		const cleanLabel = String(label || "").trim();
		const ph = pushUrlPlaceholder(String(url || ""));
		if (cleanLabel && ph) return "LNKARROW " + `${cleanLabel} (${ph})`;
		if (cleanLabel) return cleanLabel;
		if (ph) return "LNKARROW " + ph;
		return " ";
	});

	// Raw URLs
	text = text.replace(/https?:[/][/]\S+|www\.\S+/gi, match => {
		const ph = pushUrlPlaceholder(match);
		return ph ? "LNKARROW " + ph : " ";
	});

	// // Remove image filenames everywhere
	// text = text.replace(/\b[\w.-]+\.(png|jpg|jpeg|gif|svg|webp|bmp|tiff|avif)\b/gi, " ");

	// Protect remaining filenames (any ext)
	text = text.replace(/(?<![\p{L}\p{N}_-])[\p{L}\p{N}_-]+\.[\p{L}\p{N}_]{2,5}(?![\p{L}\p{N}_-])/gu, m => {
		const id = files.length;
		files.push(m);
		return `FILETOKEN${id}`;
	});

	// Protect common numeric date formats
	text = text.replace(/\b\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}\b/g, protectDate);
	text = text.replace(/\b\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}\b/g, protectDate);
	text = text.replace(/(^|\n)\s*[-*+]\s+\[([^\]\r\n])\]\s+/g, (_, prefix, state) => {
		const id = taskMarkers.length;
		taskMarkers.push(`[${String(state)}] `);
		return `${String(prefix ?? "")}TASKBOX${id}TOKEN`;
	});

	// Structural markdown / junk
	text = text
		.replace(/%%[\s\S]*?%%/g, " ")
		.replace(/<!--[\s\S]*?-->/g, " ")
		.replace(/<style[\s\S]*?<[/]style>/gi, " ")
		.replace(/<script[\s\S]*?<[/]script>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&apos;/gi, "'")
		.replace(/&nbsp;|&#160;/gi, " ")
		.replace(/&#\d+;/g, " ")
		.replace(/&[a-z]+;/gi, " ")
		.replace(/```([^`][\s\S]*?)```/g, (_, inner) => " " + inner.trim() + " ")
		.replace(/```/g, " ")
		.replace(/~~~([\s\S]*?)~~~/g, (_, inner) => " " + inner.trim() + " ")
		.replace(/`([^`]*)`/g, "$1")
		.replace(/(^|\s)#[\p{L}\p{N}_/-]+/gu, " ")
		.replace(/#+\s+/g, " ")
		.replace(/^\s*>+\s?/gm, " ")
		.replace(/^\s*[-*+]\s+/gm, " ")
		.replace(/~~([^~\n]*?)~~/g, "$1")
		.replace(/\*\*/g, " ")
		.replace(/[*_]/g, " ")
		.replace(/[=]+/g, " ")
		.replace(/\r?\n/g, " ");

	// Remove | / ( )
	text = text.replace(/[|/()]/g, " ");

	// Remove standalone dashes / en/em dashes, keep in dates/words
	text = text.replace(/[-–—-](?![\p{L}\p{N}])/gu, " ");

	// Protect decimals
	text = text.replace(/(\d)\.(\d)/g, "$1DECIM_$2");

	// Remove brackets
	text = text.replace(/[{}[\]«»„”“]/g, " ");

	// Generic punctuation
	text = text.replace(/(\d):(\d{2})/g, "$1TIMEP_$2");
	text = text.replace(/[!?;]+/g, " ");
	text = text.replace(/,(?!\d)/g, " ");
	text = text.replace(/(?<!\d)\.(?!\d)/g, " ");
	text = text.replace(/:/g, " ");
	text = text.replace(/TIMEP_/g, ":");

	// Restore decimals
	text = text.replace(/DECIM_/g, ".");

	// Restore filenames
	for (let i = 0; i < files.length; i++) {
		const ph = new RegExp(`FILETOKEN${i}`, "g");
		text = text.replace(ph, files[i]);
	}

	// Restore protected dates
	for (let i = 0; i < dateTokens.length; i++) {
		const ph = new RegExp(`DATETOKEN${i}`, "g");
		text = text.replace(ph, dateTokens[i]);
	}

	// Restore URLs
	for (let i = 0; i < urls.length; i++) {
		const ph = new RegExp(`URLPH${i}TOKEN`, "g");
		text = text.replace(ph, urls[i]);
	}

	if (summarySeparators.length > 0) {
		for (let i = 0; i < summarySeparators.length; i++) {
			const ph = new RegExp(summarySeparatorToken(i), "g");
			text = text.replace(ph, summarySeparators[i]);
		}
	}

	// Restore escaped characters (backslash dropped, literal char kept)
	for (let i = 0; i < escapedChars.length; i++) {
		text = text.replace(new RegExp(`ESCCHAR${i}TOKEN`, "g"), escapedChars[i] ?? "");
	}

	for (let i = 0; i < taskMarkers.length; i++) {
		text = text.replace(new RegExp(`TASKBOX${i}TOKEN`, "g"), taskMarkers[i] ?? "");
	}

	text = text.replace(
		/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu,
		" "
	);

	text = text.replace(/LNKARROW /g, "↗︎ ");

	return text.replace(/\s+/g, " ").trim();
}
