import { TFile } from "obsidian";
import type { EpochPlugin } from "../../main";

function normalizeTag(tag: string): string {
	const t = String(tag || "").trim().toLowerCase();
	if (!t) return "";
	return t.startsWith("#") ? t.slice(1) : t;
}

function collectTagsFromFileCache(cache: any): Set<string> {
	const out = new Set<string>();
	try {
		const tags = cache?.tags;
		if (Array.isArray(tags)) {
			for (const t of tags) {
				const norm = normalizeTag(t?.tag ?? t);
				if (norm) out.add(norm);
			}
		}
		const fmTags = cache?.frontmatter?.tags;
		if (typeof fmTags === "string") {
			for (const seg of fmTags.split(/[,\s]+/g)) {
				const norm = normalizeTag(seg);
				if (norm) out.add(norm);
			}
		} else if (Array.isArray(fmTags)) {
			for (const seg of fmTags) {
				const norm = normalizeTag(seg);
				if (norm) out.add(norm);
			}
		}
	} catch {
		// ignore
	}
	return out;
}

export function getDirectLinkedPaths(plugin: EpochPlugin, filePath: string): Set<string> {
	const out = new Set<string>();
	try {
		const mc: any = (plugin.app as any)?.metadataCache;

		// Outgoing links: prefer getFileCache (sync, reflects both additions and removals
		// immediately when metadataCache fires "changed"). resolvedLinks[filePath] lags and
		// would keep stale outgoing links after deletion until the async resolution pass runs.
		let outgoingFromFileCache = false;
		try {
			const f = plugin.app.vault.getAbstractFileByPath(filePath);
			if (f instanceof TFile) {
				const cache = mc?.getFileCache?.(f);
				if (cache) {
					outgoingFromFileCache = true;
					const rawLinks: any[] = cache?.links ?? [];
					for (const link of rawLinks) {
						const raw = typeof link?.link === "string" ? String(link.link) : "";
						if (!raw) continue;
						const resolved = mc?.getFirstLinkpathDest?.(raw, filePath);
						if (resolved instanceof TFile && resolved.path !== filePath) {
							out.add(resolved.path);
						}
					}
				}
			}
		} catch {
			// ignore
		}

		const resolvedLinks: any = mc?.resolvedLinks;
		if (resolvedLinks && typeof resolvedLinks === "object") {
			// Outgoing from filePath: only use resolvedLinks as fallback when getFileCache was unavailable.
			if (!outgoingFromFileCache) {
				const outbound = resolvedLinks[filePath];
				if (outbound && typeof outbound === "object") {
					for (const p of Object.keys(outbound)) {
						if (p) out.add(p);
					}
				}
			}
			// Inbound to filePath: no sync equivalent, always read from resolvedLinks.
			for (const src of Object.keys(resolvedLinks)) {
				const linksFromSrc = resolvedLinks[src];
				if (linksFromSrc && typeof linksFromSrc === "object" && linksFromSrc[filePath]) {
					out.add(src);
				}
			}
		}

		try {
			const f = plugin.app.vault.getAbstractFileByPath(filePath);
			if (f instanceof TFile && typeof mc?.getBacklinksForFile === "function") {
				const bl = mc.getBacklinksForFile(f);
				const data = bl?.data;
				if (data && typeof data === "object") {
					for (const src of Object.keys(data)) {
						if (src) out.add(src);
					}
				}
			}
		} catch {
			// ignore
		}
	} catch {
		// ignore
	}
	out.delete(filePath);
	return out;
}

export function getSameTagPaths(plugin: EpochPlugin, filePath: string): Set<string> {
	const out = new Set<string>();
	try {
		const mc: any = (plugin.app as any)?.metadataCache;
		const f = plugin.app.vault.getAbstractFileByPath(filePath);
		if (!(f instanceof TFile)) return out;
		const cache = mc?.getFileCache?.(f);
		const centerTags = collectTagsFromFileCache(cache);
		if (centerTags.size === 0) return out;

		for (const other of plugin.app.vault.getMarkdownFiles()) {
			if (other.path === filePath) continue;
			const oc = mc?.getFileCache?.(other);
			const otherTags = collectTagsFromFileCache(oc);
			if (otherTags.size === 0) continue;
			for (const t of centerTags) {
				if (otherTags.has(t)) {
					out.add(other.path);
					break;
				}
			}
		}
	} catch {
		// ignore
	}
	return out;
}
