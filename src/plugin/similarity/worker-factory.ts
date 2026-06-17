import type { EpochPlugin } from "../../main";
import { Notice, Platform } from "obsidian";
// NOTE: The file itself is a worker entry (no exports), but esbuild-plugin-inline-worker
// replaces the import with a default-exporting worker factory at bundle time.
// @ts-ignore
import SimilarityEmbedWorker from "../similarity-embed.worker";
import { embeddingsAllowed } from "./config";
import { safeStringify } from "./debug";
import { clearEpochProgress, setEpochProgress } from "../progress";
import { now } from "./time";
import { shouldAllowSimilarityProgressNotice, shouldShowSimilarityProgressNotice } from "./notice";
import type { WorkerEmbedResponse } from "./types";

type SimilarityWorkerProgressMsg = {
	type: "progress";
	kind?: "semantic" | "topics";
	stage?: string;
	status?: string;
	modelId?: string;
	file?: string;
	pct?: number;
	error?: string;
	message?: string;
};

function sanitizeWorkerNoticeMessage(value: string): string {
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
}

function showWorkerNoticeOnce(plugin: EpochPlugin, key: string, message: string): void {
	const msg = sanitizeWorkerNoticeMessage(String(message || "").trim());
	if (!msg) return;
	try {
		const anyPlugin: any = plugin as any;
		const lastKey = String(anyPlugin.__epochSimilarityWorkerNoticeKey ?? "");
		const lastAt = Number(anyPlugin.__epochSimilarityWorkerNoticeAt ?? 0);
		const within = lastAt > 0 && now() - lastAt < 8000;
		if (within && lastKey === key) return;
		anyPlugin.__epochSimilarityWorkerNoticeKey = key;
		anyPlugin.__epochSimilarityWorkerNoticeAt = now();
	} catch {
		// ignore
	}
	try {
		new Notice(msg, 6000);
	} catch {
		// ignore
	}
}

function handleSimilarityWorkerProgress(plugin: EpochPlugin, msg: SimilarityWorkerProgressMsg): void {
	const kind: any = msg?.kind === "topics" ? "topics" : "semantic";
	const label = kind === "topics" ? "Topics model" : "Semantics model";
	const status = String(msg?.status ?? "").trim().toLowerCase();
	const stage = String(msg?.stage ?? "").trim().toLowerCase();
	const pctRaw = Number(msg?.pct);
	const pct = Number.isFinite(pctRaw) ? Math.max(0, Math.min(100, Math.floor(pctRaw))) : -1;

	const anyPlugin: any = plugin as any;
	const doneMarker = `__epochSimilarityModelDone:${kind}`;
	const isDone = anyPlugin[doneMarker] === true;

	// Ignore all progress messages once done has been signaled
	if (isDone && status !== "error") {
		return;
	}

	if (status === "error" || msg?.error) {
		const err = sanitizeWorkerNoticeMessage(String(msg?.error ?? msg?.message ?? "Worker error").trim());
		setEpochProgress(plugin, kind, `${label} error`);
		showWorkerNoticeOnce(plugin, `${kind}:error:${String(msg?.modelId ?? "").trim()}`, `${label} failed to load. ${err}`);
		clearEpochProgress(plugin, kind, 5000);
		anyPlugin[doneMarker] = false;
		return;
	}

	if (status === "done") {
		clearEpochProgress(plugin, kind, 1500);
		anyPlugin[doneMarker] = true;
		return;
	}

	if (pct >= 0 && stage === "download") {
		const startedAtKey = `__epochSimilarityModelDownloadStartedAt:${kind}`;
		// Initialize the start time on first download message
		try {
			if (typeof anyPlugin[startedAtKey] !== "number" || anyPlugin[startedAtKey] === 0) {
				anyPlugin[startedAtKey] = now();
			}
		} catch {
			// ignore
		}
		if (shouldAllowSimilarityProgressNotice(plugin, startedAtKey)) {
			if (Platform.isDesktopApp) {
				setEpochProgress(plugin, kind, `${label}… ${pct}%`);
			} else if (shouldShowSimilarityProgressNotice(plugin)) {
				new Notice(`${label}… ${pct}%`, 900);
			}
		}
		return;
	}

	if (pct >= 0) {
		setEpochProgress(plugin, kind, `${label}… ${pct}%`);
		return;
	}

	if (stage === "runtime" && status === "configuring") {
		setEpochProgress(plugin, kind, `${label}… loading runtime`);
		anyPlugin[doneMarker] = false;
		return;
	}

	if (status === "start") {
		setEpochProgress(plugin, kind, `${label}… starting`);
		anyPlugin[doneMarker] = false;
		return;
	}
}

function isWorkerLike(w: any): w is Worker {
	return !!w && typeof w === "object" && typeof (w as any).postMessage === "function";
}

function describeWorkerFactoryShape(v: any): any {
	try {
		if (v == null) return { type: "null" };
		const t = typeof v;
		if (t === "function") return { type: "function", name: (v as any).name || "(anonymous)" };
		if (t === "string") return { type: "string", len: (v as string).length };
		if (t === "object") return { type: "object", keys: Object.keys(v).slice(0, 20) };
		return { type: t };
	} catch {
		return { type: "unknown" };
	}
}

function createWorkerMaybeModule(WorkerCtor: any, url: string): Worker | null {
	if (!WorkerCtor || !url) return null;
	try {
		const w = new WorkerCtor(url, { type: "module" });
		return isWorkerLike(w) ? (w as any) : null;
	} catch {
		try {
			const w = new WorkerCtor(url);
			return isWorkerLike(w) ? (w as any) : null;
		} catch {
			return null;
		}
	}
}

function tryCreateWorkerFromFactory(factory: any): Worker | null {
	if (!factory) return null;
	const WorkerCtor: any = (window as any)?.Worker ?? (window as any)?.window?.Worker;
	if (isWorkerLike(factory)) return factory as any;
	if (typeof factory === "string" && WorkerCtor) {
		return createWorkerMaybeModule(WorkerCtor, factory);
	}
	if (typeof factory === "function") {
		try {
			const w = factory();
			if (isWorkerLike(w)) return w as any;
		} catch {
			// ignore
		}
		try {
			const w = new (factory as any)();
			if (isWorkerLike(w)) return w as any;
		} catch {
			// ignore
		}
	}
	try {
		const d = (factory as any)?.default;
		if (d && d !== factory) return tryCreateWorkerFromFactory(d);
	} catch {
		// ignore
	}
	return null;
}

export function getSimilarityWorker(plugin: EpochPlugin): Worker | null {
	const anyPlugin: any = plugin as any;
	if (anyPlugin.similarityWorkerDisabled === true) return null;
	const WorkerCtor: any = (window as any)?.Worker ?? (window as any)?.window?.Worker;
	if (!WorkerCtor) {
		anyPlugin.similarityWorkerLastCreateError = "Worker is undefined";
		return null;
	}
	if (!embeddingsAllowed()) return null;

	let w: Worker | null = anyPlugin.similarityWorker ?? null;
	if (w) return w;
	try {
		const factory: any = SimilarityEmbedWorker as any;
		const g: any = window as any;
		const originalWorker = g?.Worker;
		let spoofedWorker = false;
		let wrappedWorker = false;
		let moduleWorkerCtor: any = null;
		try {
			if (WorkerCtor) {
				moduleWorkerCtor = function ModuleEpochSimilarityWorker(this: any, url: any, options?: any) {
					const merged = { ...(options || {}), type: "module" };
					return new WorkerCtor(url, merged);
				};
				try {
					(moduleWorkerCtor as any).prototype = WorkerCtor.prototype;
				} catch {
					// ignore
				}
				g.Worker = moduleWorkerCtor;
				wrappedWorker = true;
				if (!originalWorker) spoofedWorker = true;
			}
			w = tryCreateWorkerFromFactory(factory);
		} finally {
			if (wrappedWorker || spoofedWorker) g.Worker = originalWorker;
		}
		if (!w) {
			anyPlugin.similarityWorkerLastCreateError = `Worker factory did not produce a Worker. shape=${safeStringify(describeWorkerFactoryShape(factory), 300)}`;
			return null;
		}
		anyPlugin.similarityWorker = w;
		anyPlugin.similarityWorkerNextId = 1;
		anyPlugin.similarityWorkerLastCreateError = null;
		anyPlugin.similarityWorkerPending = new Map<
			number,
			{ resolve: (v: WorkerEmbedResponse) => void; reject: (e: any) => void }
		>();
		w.onmessage = (ev: MessageEvent) => {
			try {
				const raw: any = ev?.data as any;
				if (raw && typeof raw === "object" && raw.type === "progress") {
					handleSimilarityWorkerProgress(plugin, raw as any);
					return;
				}
				const msg: WorkerEmbedResponse = raw as any;
				const id = Number((msg as any)?.id);
				const pending: Map<number, any> = anyPlugin.similarityWorkerPending;
				const entry = pending?.get?.(id);
				if (!entry) return;
				pending.delete(id);
				if ((msg as any)?.ok === true) {
					entry.resolve(msg);
					return;
				}
				const err = String((msg as any)?.error || "Worker request failed");
				entry.reject(new Error(err));
			} catch {
				// ignore
			}
		};
		w.onmessageerror = (e: any) => {
			try {
				anyPlugin.similarityWorkerLastCrashError = "Worker message deserialization failed";
				anyPlugin.similarityWorkerLastCrashAt = now();
			} catch {
				// ignore
			}
			void e;
		};
		w.onerror = (e: any) => {
			try {
				const msg = String(e?.message || e?.error?.message || "Worker crashed");
				const file = String(e?.filename || "");
				const line = Number(e?.lineno ?? e?.lineNumber ?? 0) || 0;
				const col = Number(e?.colno ?? e?.columnNumber ?? 0) || 0;
				const err = e?.error ? safeStringify(e.error, 2000) : null;
				anyPlugin.similarityWorkerLastCrashError = [msg, file ? `@ ${file}:${line}:${col}` : null, err].filter(Boolean).join(" ");
				anyPlugin.similarityWorkerLastCrashAt = now();
				anyPlugin.similarityWorkerLastCrashEvent = safeStringify(
					{ message: msg, filename: file || null, lineno: line || null, colno: col || null },
					800
				);
				const prevAt = Number(anyPlugin.similarityWorkerCrashWindowAt ?? 0);
				const prevCount = Number(anyPlugin.similarityWorkerCrashCount ?? 0);
				const WINDOW_MS = 30_000;
				const within = prevAt > 0 && now() - prevAt < WINDOW_MS;
				anyPlugin.similarityWorkerCrashWindowAt = within ? prevAt : now();
				anyPlugin.similarityWorkerCrashCount = within ? prevCount + 1 : 1;
				if ((anyPlugin.similarityWorkerCrashCount as number) >= 3) {
					anyPlugin.similarityWorkerDisabled = true;
					anyPlugin.similarityWorkerLastCreateError = "Worker disabled after repeated crashes";
				}
			} catch {
				// ignore
			}
			void e;
			try {
				const pending: Map<number, any> = anyPlugin.similarityWorkerPending;
				if (pending && pending.size > 0) {
					for (const [, entry] of pending) {
						try {
							entry.reject(new Error("Worker crashed"));
						} catch { void 0; }
					}
					pending.clear();
				}
			} catch {
				// ignore
			}
			try {
				w?.terminate?.();
			} catch {
				// ignore
			}
			try {
				anyPlugin.similarityWorker = null;
			} catch {
				// ignore
			}
			return true;
		};
		return w;
	} catch (e: any) {
		anyPlugin.similarityWorkerLastCreateError = String(e?.message || e || "Worker creation failed");
		return null;
	}
}
