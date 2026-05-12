import { Notice, Platform } from "obsidian";
import type { EpochPlugin } from "../../main";
import type { SimilarityMethods } from "./api-types";
import {
	embeddingsAllowed,
	embeddingsSimilarityEnabled,
	getSimilarityModelId,
	isTopicSimilarityEnabled
} from "./config";
import { loadEmbeddingsModelViaWorker } from "./worker-embed";
import { now } from "./time";
import { readStore, writeStore } from "./store";
import { sortFilesNewestRecordFirst } from "./files";
import { buildNoteVector } from "./vectors-build";
import {
	shouldAllowSimilarityProgressNotice,
	scheduleSimilarityNoticeAfterGrace,
	shouldShowSimilarityProgressNotice
} from "./notice";
import { isUserEditingMarkdown } from "../notice-utils";
import { getEmbeddingTermForPath, getTermVocabulary } from "./topic";
import { writeTermStore } from "../similarity-term-store";
import { clearEpochProgress, consumeCancelRequested, setEpochProgress } from "../progress";
import { announceEpochDesktopTaskAfter, cancelEpochDesktopTaskAnnouncement } from "../progress";
import { isLikelyTextFileExtension } from "../../utils";
import { hasSimilarityAccess } from "../pro-feature-state";


async function preflightFullRebuild(plugin: EpochPlugin): Promise<void> {
	const anyPlugin: any = plugin as any;
	if (Platform.isDesktopApp) {
		announceEpochDesktopTaskAfter(plugin, "semanticBuild:started", "Building semantics started", {
			graceMs: 1000,
			still: () => {
				try {
					return !!(plugin as any).similarityFullRebuildRunning;
				} catch {
					return true;
				}
			}
		});
	}
	try {
		anyPlugin.similarityFullRebuildRunning = true;
		// A full rebuild supersedes incremental vector updates; clear any pending queue
		// so users don't see both "Updating" and "Building" notices for the same action.
		try {
			if (anyPlugin.similarityQueueTimer) {
				clearTimeout(anyPlugin.similarityQueueTimer);
				anyPlugin.similarityQueueTimer = null;
			}
			anyPlugin.similarityPendingFiles = new Set<string>();
			anyPlugin.similarityQueueTotal = 0;
			anyPlugin.similarityQueueProcessed = 0;
			anyPlugin.similarityVectorUpdateStartedAt = 0;
		} catch {
			// ignore
		}
	} catch {
		// ignore
	}
	try {
		anyPlugin.similarityRebuildStartedAt = now();
	} catch {
		// ignore
	}
}

function finishFullRebuild(plugin: EpochPlugin): void {
	const anyPlugin: any = plugin as any;
	try {
		anyPlugin.similarityFullRebuildRunning = false;
	} catch {
		// ignore
	}
	try {
		delete (plugin as any)?.__epochCancelRequestedAt?.semanticBuild;
	} catch {
		// ignore
	}
	try {
		if (Platform.isDesktopApp) {
			cancelEpochDesktopTaskAnnouncement(plugin, "semanticBuild:started");
		}
	} catch {
		// ignore
	}
}

async function rebuildSemanticVectorsWithProgress(plugin: EpochPlugin): Promise<void> {
	const anyPlugin: any = plugin as any;
	if (!hasSimilarityAccess(plugin)) return;
	if (!embeddingsAllowed()) return;
	if (!embeddingsSimilarityEnabled(plugin)) return;

	const modelId = getSimilarityModelId(plugin);
	const loaded = await loadEmbeddingsModelViaWorker(plugin, modelId);
	if (!loaded) {
		const lastErr = String(anyPlugin?.similarityWorkerLastLoadError ?? "").trim();
		const lastErrModel = String(anyPlugin?.similarityWorkerLastLoadErrorModelId ?? "").trim();
		const createErr = String(anyPlugin?.similarityWorkerLastCreateError ?? "").trim();
		const sanitizeReason = (value: string): string => {
			const raw = String(value ?? "").replace(/\r/g, "").trim();
			if (!raw) return "";
			const lines = raw.split("\n");
			const kept: string[] = [];
			for (const line of lines) {
				const t = String(line ?? "").trim();
				if (!t) continue;
				if (/^at\s+/.test(t)) break;
				if (t.includes("blob:app://")) break;
				kept.push(t);
				if (kept.length >= 3) break;
			}
			let out = kept.length ? kept.join(" ") : raw.split("\n")[0].trim();
			out = out.replace(/\s+/g, " ").trim();
			const MAX = 280;
			if (out.length > MAX) out = `${out.slice(0, MAX - 1).trimEnd()}…`;
			return out;
		};
		const reason = sanitizeReason(lastErr || createErr || "Semantic vectors worker unavailable");
		const modelSuffix =
			lastErrModel && lastErrModel !== modelId ? ` (last model: ${lastErrModel})` : "";
		if (!isUserEditingMarkdown(plugin.app)) {
			new Notice(`Semantic vectors failed to load${modelSuffix}: ${reason}`, 5000);
		}
		return;
	}

	let reuseVectorByHash: Map<string, number[]> | null = null;
	try {
		const prev = await readStore(plugin);
		if (prev && prev.model === modelId && prev.files && typeof prev.files === "object") {
			reuseVectorByHash = new Map<string, number[]>();
			for (const [p, rec] of Object.entries(prev.files)) {
				void p;
				const h = typeof (rec as any)?.h === "string" ? String((rec as any).h) : "";
				const v = (rec as any)?.v;
				if (!h) continue;
				if (!Array.isArray(v) || v.length === 0) continue;
				reuseVectorByHash.set(h, v as number[]);
			}
		}
	} catch {
		reuseVectorByHash = null;
	}

	const store = { model: modelId, dim: 0, files: {} as Record<string, any> };
	await writeStore(plugin, store as any);

	const files = sortFilesNewestRecordFirst(
		plugin,
		plugin.app.vault
			.getFiles()
			.filter((f) => plugin.shouldIndexFile(f) && isLikelyTextFileExtension(String((f as any)?.extension ?? "")))
	);
	const total = files.length;
	let processed = 0;
	let lastWriteAt = now();
	for (const f of files) {
		try {
			if (Platform.isDesktopApp && consumeCancelRequested(plugin, "semanticBuild")) {
				break;
			}
		} catch {
			// ignore
		}
		processed++;
		try {
			const built = await buildNoteVector(plugin, f, modelId, reuseVectorByHash ?? undefined);
			if (!built) continue;
			(store as any).files[f.path] = { v: built.vector, h: built.hash, updatedAt: now() };
			if (!(store as any).dim && built.vector.length) (store as any).dim = built.vector.length;
		} catch {
			// ignore
		}

		if (
			shouldShowSimilarityProgressNotice(plugin) &&
			!isUserEditingMarkdown(plugin.app) &&
			shouldAllowSimilarityProgressNotice(plugin, "similarityRebuildStartedAt")
		) {
			if (Platform.isDesktopApp) {
				setEpochProgress(plugin, "semanticBuild", `Semantics build… ${processed}/${total}`);
			} else {
				new Notice(`Semantics build… ${processed}/${total}`, 900);
			}
		}
		const elapsedSinceWrite = now() - lastWriteAt;
		if (processed % 250 === 0 || elapsedSinceWrite > 15_000) {
			await writeStore(plugin, store as any);
			lastWriteAt = now();
		}
	}

	await writeStore(plugin, store as any);
	scheduleSimilarityNoticeAfterGrace(
		plugin,
		"similarityRebuildStartedAt",
		`Semantic vectors built: ${processed}/${total}`,
		2000
	);
	try {
		if (Platform.isDesktopApp) {
			clearEpochProgress(plugin, "semanticBuild", 1500);
		}
	} catch {
		// ignore
	}
}

async function rebuildTopics(plugin: EpochPlugin): Promise<void> {
	if (!hasSimilarityAccess(plugin)) return;
	if (!isTopicSimilarityEnabled(plugin)) return;

	try {
		const vocab = getTermVocabulary(plugin);
		await writeTermStore(plugin, { model: "zeroshot", files: {} } as any);
		const mdFiles = sortFilesNewestRecordFirst(
			plugin,
			plugin.app.vault.getMarkdownFiles().filter((f) => plugin.shouldIndexFile(f))
		);
		if (vocab.terms.length > 0) {
			for (const f of mdFiles) {
				try {
					const explicit = getEmbeddingTermForPath(plugin, f.path);
					if (explicit) continue;
					(plugin as any).queueTermSimilarityUpdate?.(f.path);
				} catch {
					// ignore
				}
			}
		}
	} catch {
		// ignore
	}
}

export const methodsRebuild: Pick<
	SimilarityMethods,
	"rebuildRelationsWithProgress" | "rebuildSemanticVectorsWithProgress" | "rebuildTopicsWithProgress"
> = {
	async rebuildSemanticVectorsWithProgress(this: EpochPlugin): Promise<void> {
		const anyPlugin: any = this as any;
		try {
			await preflightFullRebuild(this);
			await rebuildSemanticVectorsWithProgress(this);
		} finally {
			try {
				anyPlugin.similarityFullRebuildRunning = false;
			} catch {
				// ignore
			}
			finishFullRebuild(this);
		}
	},

	async rebuildTopicsWithProgress(this: EpochPlugin): Promise<void> {
		try {
			await rebuildTopics(this);
		} finally {
			// no-op
		}
	},

	async rebuildRelationsWithProgress(this: EpochPlugin): Promise<void> {
		await preflightFullRebuild(this);
		try {
			await rebuildSemanticVectorsWithProgress(this);
			await rebuildTopics(this);
		} finally {
			finishFullRebuild(this);
		}
	}
};
