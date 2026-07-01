import { MarkdownView, TFile } from "obsidian";
import type { EpochPlugin } from "../../main";
import { computeAiSummaryInputHash, isLikelyTextFileExtension } from "../../utils";
import { getSimilarityModelId } from "./config";
import { embedPooledChunks } from "./worker-embed";
import { clampSimilarityContent, chunkText, getPreferredSimilarityText, stripFrontmatter } from "./text";

type MarkdownViewWithEditor = MarkdownView & {
	editor?: {
		getValue?: () => string;
	};
};

function isEpochgramExportHtml(file: TFile): boolean {
	try {
		const ext = String(file?.extension || "").toLowerCase();
		if (ext !== "html" && ext !== "htm") return false;
		const base = String(file.basename ?? "").toLowerCase();
		return base.startsWith("epochgram-");
	} catch {
		return false;
	}
}

export async function buildNoteVector(
	plugin: EpochPlugin,
	file: TFile,
	modelId: string,
	reuseVectorByHash?: Map<string, number[]>
): Promise<{ vector: number[]; hash: string } | null> {
	if (!file) return null;
	const ext = String(file.extension || "").toLowerCase();
	if (!isLikelyTextFileExtension(ext)) return null;
	if (isEpochgramExportHtml(file)) return null;
	if (!plugin.shouldIndexFile?.(file)) return null;

	let baseText = "";
	try {
		const view = plugin.app.workspace.getActiveViewOfType?.(MarkdownView);
		if (view?.file?.path === file.path) {
			const live = (view as MarkdownViewWithEditor)?.editor?.getValue?.();
			if (typeof live === "string") {
				baseText = stripFrontmatter(live);
			}
		}
	} catch {
		baseText = "";
	}

	if (!baseText) {
		try {
			baseText = getPreferredSimilarityText(plugin, file.path);
		} catch {
			baseText = "";
		}
	}

	if (!baseText) {
		try {
			baseText = await plugin.app.vault.read(file);
			baseText = stripFrontmatter(baseText);
		} catch {
			baseText = "";
		}
	}

	const body = clampSimilarityContent(baseText);
	const inputParts: string[] = [];
	if (body) inputParts.push(body);
	const input = inputParts.join("\n\n");
	const hash = computeAiSummaryInputHash(file.path, `embed|${modelId || getSimilarityModelId(plugin)}`, input, 12000);

	try {
		if (reuseVectorByHash && typeof reuseVectorByHash.get === "function") {
			const reused = reuseVectorByHash.get(hash);
			if (Array.isArray(reused) && reused.length > 0) {
				return { vector: reused, hash };
			}
		}
	} catch {
		// ignore
	}

	const chunks = chunkText(input, 3500);
	if (chunks.length === 0) {
		return { vector: [], hash };
	}

	const pooled = await embedPooledChunks(plugin, modelId, chunks);
	return { vector: pooled, hash };
}
