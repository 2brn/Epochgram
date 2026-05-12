import { flattenForSummary } from "./flattener";
import { SUMMARY_SEPARATOR_SYMBOL } from "../ui/epoch-canvas-constants";
import { sanitizeSummaryText } from "../utils";
import { buildFrontmatterPropertyLineRegex } from "../plugin/frontmatter-keys";

const SUMMARY_MAX_CHARS = 8000;

export function extractFrontmatterDescription(raw: string, propertyKey: string): string {
    try {
        const input = String(raw ?? "");
        if (!input) return "";
        const lineRegex = buildFrontmatterPropertyLineRegex(propertyKey);
        const normalized = input.replace(/^\uFEFF/, "");
        if (!/^---\r?\n/.test(normalized)) return "";
        const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/m.exec(normalized);
        if (!m) return "";
        const fm = String(m[1] ?? "");
        const lines = fm.split(/\r?\n/g);

        for (let i = 0; i < lines.length; i++) {
            const line = String(lines[i] ?? "");
            const match = line.match(lineRegex);
            if (!match) continue;
            let value = String(match[1] ?? "");
            if (!value.trim()) return "";
            const trimmed = value.trim();

            const blockStyle = (() => {
                if (/^\|[+-]?\s*$/.test(trimmed)) return "literal";
                if (/^>[+-]?\s*$/.test(trimmed)) return "folded";
                return "";
            })();
            if (blockStyle) {
                const outLines: string[] = [];
                for (let j = i + 1; j < lines.length; j++) {
                    const next = String(lines[j] ?? "");
                    if (next.trim() === "") {
                        outLines.push("");
                        continue;
                    }
                    if (!/^\s+/.test(next)) break;
                    outLines.push(next.replace(/^\s+/, ""));
                }
                const blockText = outLines.join("\n").trim();
                if (!blockText) return "";
                if (blockStyle === "literal") return blockText;
                return blockText
                    .split(/\n\n+/g)
                    .map((p) => p.replace(/\n+/g, " ").trim())
                    .filter(Boolean)
                    .join("\n\n");
            }

            if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
                value = trimmed.slice(1, -1);
            } else {
                value = trimmed;
            }
            return value.trim();
        }
        return "";
    } catch {
        return "";
    }
}

function findPreferredMarkdownSummaryStart(raw: string, descriptionPropertyKey?: string): string {
    if (!raw) return "";
    const text0 = raw.length > SUMMARY_MAX_CHARS ? raw.slice(0, SUMMARY_MAX_CHARS) : raw;

    // Prefer YAML frontmatter description when a property key is provided.
    if (descriptionPropertyKey) {
        const described = extractFrontmatterDescription(text0, descriptionPropertyKey);
        if (described) return described;
    }

    // Best-effort: ignore YAML frontmatter when deciding the start; keep code content.
    const text = text0
        .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/m, "")
        .replace(/```([^`][\s\S]*?)```/g, (_, inner) => inner)
        .replace(/```/g, "")
        .replace(/~~~([\s\S]*?)~~~/g, (_, inner) => inner);

    // Ignore embeds/links when looking for "formatted" starts; otherwise filenames/paths
    // (often containing underscores) can trip the emphasis regexes.
    const scanText = text
        // Obsidian embeds ![[...]]
        .replace(/!\[\[[^\]]*]]/g, " ")
        // Wiki links [[...]]
        .replace(/\[\[[^\]]*]]/g, " ")
        // Markdown links [label](url)
        .replace(/\[[^\]]*]\([^)]*\)/g, " ")
        // Inline code: keep content but neutralise formatting chars inside
        .replace(/`([^`]*)`/g, (_, inner) => inner.replace(/[*_~=]/g, " "));

    // When looking for formatted starts (==, **, __, *, _, ~~), ignore any such markers
    // that occur inside raw URLs/URIs. URLs can contain these sequences (e.g. base64, ids)
    // and we don't want a link target to become the summary start.
    const uriRegex = /\b[a-z][a-z0-9+.-]*:\/\/\S+|\bwww\.\S+/gi;
    const signalText = scanText
        .replace(/\\[*_~=`]/g, "  ")
        .replace(uriRegex, (m) => " ".repeat(m.length));

    const isWordChar = (ch: string): boolean => {
        if (!ch) return false;
        if (ch === "_") return true;
        try {
            return /[\p{L}\p{N}]/u.test(ch);
        } catch {
            return /[A-Za-z0-9]/.test(ch);
        }
    };

    const isUnderscoreEmphasisBoundary = (ch: string): boolean => {
        if (!ch) return true;
        if (ch === "=") return false;
        return !isWordChar(ch);
    };

    const isSimpleIdentifierToken = (s: string): boolean => {
        if (!s) return false;
        if (!/^[A-Za-z][A-Za-z0-9]*$/.test(s)) return false;
        return true;
    };

    const UNDERSCORE_CODELIKE_STOPLIST = new Set([
        "id",
        "uid",
        "guid",
        "init",
        "main",
        "this",
        "self",
        "true",
        "false",
        "null",
        "undefined"
    ]);

    const considerUnderscoreMatch = (start: number, endExclusive: number, inner: string): boolean => {
        if (!(start >= 0 && endExclusive > start)) return false;
        const before = start - 1 >= 0 ? signalText[start - 1] ?? "" : "";
        const after = endExclusive < signalText.length ? signalText[endExclusive] ?? "" : "";
        if (!isUnderscoreEmphasisBoundary(before)) return false;
        if (!isUnderscoreEmphasisBoundary(after)) return false;

        const trimmed = String(inner ?? "").trim();
        if (!trimmed) return false;
        // Skip identifier-ish / key=value-ish payloads.
        if (trimmed.includes("_")) return false;
        if (trimmed.includes("=")) return false;
        if (isSimpleIdentifierToken(trimmed) && UNDERSCORE_CODELIKE_STOPLIST.has(trimmed.toLowerCase())) return false;
        consider(start);
        return true;
    };

    const isAsteriskEmphasisBoundary = (ch: string): boolean => {
        if (!ch) return true;
        return !isWordChar(ch);
    };

    const considerAsteriskMatch = (start: number, endExclusive: number, inner: string): boolean => {
        if (!(start >= 0 && endExclusive > start)) return false;
        const before = start - 1 >= 0 ? signalText[start - 1] ?? "" : "";
        const after = endExclusive < signalText.length ? signalText[endExclusive] ?? "" : "";
        if (!isAsteriskEmphasisBoundary(before)) return false;
        if (!isAsteriskEmphasisBoundary(after)) return false;

        const trimmed = String(inner ?? "").trim();
        if (!trimmed) return false;
        if (trimmed !== inner) return false;
        consider(start);
        return true;
    };

    const considerTildeMatch = (start: number, endExclusive: number, inner: string): boolean => {
        if (!(start >= 0 && endExclusive > start)) return false;
        const before = start - 1 >= 0 ? signalText[start - 1] ?? "" : "";
        const after = endExclusive < signalText.length ? signalText[endExclusive] ?? "" : "";
        if (isWordChar(before)) return false;
        if (isWordChar(after)) return false;

        const trimmed = String(inner ?? "").trim();
        if (!trimmed) return false;
        if (trimmed !== inner) return false;
        consider(start);
        return true;
    };

    const considerEqualsMatch = (start: number, endExclusive: number, inner: string): boolean => {
        if (!(start >= 0 && endExclusive > start)) return false;
        const before = start - 1 >= 0 ? signalText[start - 1] ?? "" : "";
        const after = endExclusive < signalText.length ? signalText[endExclusive] ?? "" : "";
        if (isWordChar(before)) return false;
        if (isWordChar(after)) return false;

        const trimmed = String(inner ?? "").trim();
        if (!trimmed) return false;
        if (trimmed !== inner) return false;
        consider(start);
        return true;
    };

    let bestIndex = Number.POSITIVE_INFINITY;
    const consider = (idx: number): void => {
        if (!Number.isFinite(idx) || idx < 0) return;
        if (idx < bestIndex) bestIndex = idx;
    };

    // highlights ==like this==
    {
        const re = /==([^=\n][^=\n]*?)==/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(signalText)) !== null) {
            const inner = String(m[1] ?? "");
            if (considerEqualsMatch(m.index, m.index + String(m[0] ?? "").length, inner)) break;
        }
    }
    // bold **like this** or __like this__
    {
        const reA = /\*\*([^*\n][^*\n]*?)\*\*/g;
        let mA: RegExpExecArray | null;
        while ((mA = reA.exec(signalText)) !== null) {
            const start = mA.index;
            const match = String(mA[0] ?? "");
            const inner = String(mA[1] ?? "");
            if (considerAsteriskMatch(start, start + match.length, inner)) break;
        }

        const reB = /__([^_\n][^_\n]*?)__/g;
        let mB: RegExpExecArray | null;
        while ((mB = reB.exec(signalText)) !== null) {
            const start = mB.index;
            const match = String(mB[0] ?? "");
            const inner = String(mB[1] ?? "");
            // Skip if part of a longer underscore run (e.g. ___)
            const before = start - 1 >= 0 ? signalText[start - 1] ?? "" : "";
            const after = start + match.length < signalText.length ? signalText[start + match.length] ?? "" : "";
            if (before === "_" || after === "_") continue;
            if (considerUnderscoreMatch(start, start + match.length, inner)) break;
        }
    }
    // italic *like this* or _like this_ (avoid matching **bold** / __bold__)
    {
        const reA = /(^|[^*])\*([^*\n][^*\n]*?)\*(?!\*)/g;
        let mA: RegExpExecArray | null;
        while ((mA = reA.exec(signalText)) !== null) {
            const prefix = String(mA[1] ?? "");
            const inner = String(mA[2] ?? "");
            const start = mA.index + prefix.length;
            const matchLen = 1 + inner.length + 1;
            if (considerAsteriskMatch(start, start + matchLen, inner)) break;
        }

        const reB = /(^|[^_])_([^_\n][^_\n]*?)_(?!_)/g;
        let mB: RegExpExecArray | null;
        while ((mB = reB.exec(signalText)) !== null) {
            const prefix = String(mB[1] ?? "");
            const inner = String(mB[2] ?? "");
            const start = mB.index + prefix.length;
            const matchLen = 1 + inner.length + 1;
            // Skip if this would overlap a double-underscore run.
            const before = start - 1 >= 0 ? signalText[start - 1] ?? "" : "";
            const after = start + matchLen < signalText.length ? signalText[start + matchLen] ?? "" : "";
            if (before === "_" || after === "_") continue;
            if (considerUnderscoreMatch(start, start + matchLen, inner)) break;
        }
    }
    // strikethrough ~~like this~~
    {
        const re = /~~([^~\n][^~\n]*?)~~/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(signalText)) !== null) {
            const start = m.index;
            const match = String(m[0] ?? "");
            const inner = String(m[1] ?? "");
            if (considerTildeMatch(start, start + match.length, inner)) break;
        }
    }
    // blockquotes ("> quote") - including list-nested
    {
        const re = /^(\s*(?:[-*+]\s+|\d+\.\s+)?\s*>+\s?)(.*)$/gm;
        let m: RegExpExecArray | null;
        while ((m = re.exec(signalText)) !== null) {
            const prefix = String(m[1] ?? "");
            const line = String(m[2] ?? "").trim();
            if (!line) continue;
            if (/^\[!\w+/i.test(line)) continue;
            consider(m.index + prefix.length);
            break;
        }
    }
    // headers (#, ##, ...)
    {
        const re = /^(\s*(#{1,6})\s+)(.+?)\s*#*\s*$/gm;
        let m: RegExpExecArray | null;
        const firstByLevel = new Map<number, number>();
        while ((m = re.exec(signalText)) !== null) {
            const prefix = String(m[1] ?? "");
            const hashes = String(m[2] ?? "");
            const level = hashes.length;
            if (!(level >= 1 && level <= 6)) continue;
            if (firstByLevel.has(level)) continue;

            const line = String(m[3] ?? "").trim();
            if (!line) continue;

            firstByLevel.set(level, m.index + prefix.length);
        }

        for (let level = 1; level <= 6; level++) {
            const idx = firstByLevel.get(level);
            if (idx == null) continue;
            consider(idx);
            break;
        }
    }

    if (!Number.isFinite(bestIndex) || bestIndex === Number.POSITIVE_INFINITY) return "";
    return scanText.slice(bestIndex);
}

export function makeSummary(
    text: string,
    n: number,
    options: { descriptionPropertyKey?: string; skipFlatten?: boolean } = { descriptionPropertyKey: "description" }
): string {
    if (!text) return "";
    const clipped0 = text.length > SUMMARY_MAX_CHARS ? text.slice(0, SUMMARY_MAX_CHARS) : text;
    const clipped = sanitizeSummaryText(clipped0);
    const manualDescription = options.descriptionPropertyKey
        ? extractFrontmatterDescription(clipped, options.descriptionPropertyKey).trim()
        : "";
    const preferredStart = manualDescription || findPreferredMarkdownSummaryStart(clipped, undefined);
    const original = (preferredStart || clipped).trim();
    const effectiveText = (manualDescription || options.skipFlatten) ? original : (flattenForSummary(original).trim() || original);
    if (!effectiveText) return "";

    const tokens = effectiveText.match(/\[[xX ]\]|\S+/g) ?? [];
    const isSeparator = SUMMARY_SEPARATOR_SYMBOL
        ? (token: string): boolean => token === SUMMARY_SEPARATOR_SYMBOL
        : () => false;
    const isLinkArrow = (token: string): boolean => token === "↗︎" || token === "↗";
    const isTaskMarker = (token: string): boolean => /^\[[xX ]\]$/.test(token);
    const isIgnoredWordToken = (token: string): boolean => isLinkArrow(token) || isTaskMarker(token);

    let totalWords = 0;
    for (const token of tokens) {
        if (!isSeparator(token) && !isIgnoredWordToken(token)) {
            totalWords++;
        }
    }

    const maxWords = Math.max(0, n);
    if (maxWords === 0) {
        return "";
    }

    if (totalWords <= maxWords) {
        const fullTokens = [...tokens];
        trimTrailingSeparators(fullTokens, isSeparator);
        trimTrailingLinkArrows(fullTokens, isLinkArrow);
        return fullTokens.join(" ");
    }

    const out: string[] = [];
    let usedWords = 0;
    for (const token of tokens) {
        if (isSeparator(token)) {
            if (out.length === 0) continue;
            out.push(token);
            continue;
        }
        if (isIgnoredWordToken(token)) {
            out.push(token);
            continue;
        }
        if (usedWords >= maxWords) break;
        out.push(token);
        usedWords++;
        if (usedWords >= maxWords) break;
    }

    trimTrailingSeparators(out, isSeparator);
    trimTrailingLinkArrows(out, isLinkArrow);
    let summary = out.join(" ");
    if (summary && totalWords > maxWords && !summary.endsWith("...")) {
        summary += "...";
    }
    return summary;
}

function trimTrailingSeparators(tokens: string[], isSeparator: (token: string) => boolean): void {
    for (let i = tokens.length - 1; i >= 0; i--) {
        if (!isSeparator(tokens[i]!)) break;
        tokens.pop();
    }
}

function trimTrailingLinkArrows(tokens: string[], isLinkArrow: (token: string) => boolean): void {
    for (let i = tokens.length - 1; i >= 0; i--) {
        if (!isLinkArrow(tokens[i]!)) break;
        tokens.pop();
    }
}