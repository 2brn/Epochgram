import type { EpochPlugin } from "../../main";
import { Notice, Platform } from "obsidian";
// NOTE: The file itself is a worker entry (no exports), but esbuild-plugin-inline-worker
// replaces the import with a default-exporting worker factory at bundle time.
// @ts-ignore
import SimilarityEmbedWorker from "../similarity-embed.worker";
import { embeddingsAllowed } from "./config";
import { safeStringify } from "./debug";
import { clearEpochProgress, setEpochProgress, type EpochProgressKind } from "../progress";
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

type SimilarityWorkerPendingEntry = {
	resolve: (v: WorkerEmbedResponse) => void;
	reject: (e: unknown) => void;
};

type SimilarityWorkerRuntime = {
	__epochSimilarityWorkerNoticeKey?: string;
	__epochSimilarityWorkerNoticeAt?: number;
	similarityWorkerDisabled?: boolean;
	similarityWorkerLastCreateError?: string | null;
	similarityWorker?: Worker | null;
	similarityWorkerNextId?: number;
	similarityWorkerPending?: Map<number, SimilarityWorkerPendingEntry>;
	similarityWorkerLastCrashError?: string;
	similarityWorkerLastCrashAt?: number;
	similarityWorkerLastCrashEvent?: string;
	similarityWorkerCrashWindowAt?: number;
	similarityWorkerCrashCount?: number;
};

type BrowserWindowLike = Window & { Worker?: typeof Worker; window?: Window };

type WorkerFactoryFn = (() => unknown) & (new () => unknown) & { default?: unknown };

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
		const runtime = plugin as unknown as SimilarityWorkerRuntime;
		const lastKey = String(runtime.__epochSimilarityWorkerNoticeKey ?? "");
		const lastAt = Number(runtime.__epochSimilarityWorkerNoticeAt ?? 0);
		const within = lastAt > 0 && now() - lastAt < 8000;
		if (within && lastKey === key) return;
		runtime.__epochSimilarityWorkerNoticeKey = key;
		runtime.__epochSimilarityWorkerNoticeAt = now();
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
	const kind: EpochProgressKind = msg?.kind === "topics" ? "topics" : "semantic";
	const label = kind === "topics" ? "Topics model" : "Semantics model";
	const status = String(msg?.status ?? "").trim().toLowerCase();
	const stage = String(msg?.stage ?? "").trim().toLowerCase();
	const pctRaw = Number(msg?.pct);
	const pct = Number.isFinite(pctRaw) ? Math.max(0, Math.min(100, Math.floor(pctRaw))) : -1;

	const runtime = plugin as unknown as SimilarityWorkerRuntime;
	const doneMarker = `__epochSimilarityModelDone:${kind}`;
	const isDone = (runtime as unknown as Record<string, unknown>)[doneMarker] === true;

	// Ignore all progress messages once done has been signaled
	if (isDone && status !== "error") {
		return;
	}

	if (status === "error" || msg?.error) {
		const err = sanitizeWorkerNoticeMessage(String(msg?.error ?? msg?.message ?? "Worker error").trim());
		setEpochProgress(plugin, kind, `${label} error`);
		showWorkerNoticeOnce(plugin, `${kind}:error:${String(msg?.modelId ?? "").trim()}`, `${label} failed to load. ${err}`);
		clearEpochProgress(plugin, kind, 5000);
		(runtime as unknown as Record<string, unknown>)[doneMarker] = false;
		return;
	}

	if (status === "done") {
		clearEpochProgress(plugin, kind, 1500);
		(runtime as unknown as Record<string, unknown>)[doneMarker] = true;
		return;
	}

	if (pct >= 0 && stage === "download") {
		const startedAtKey = `__epochSimilarityModelDownloadStartedAt:${kind}`;
		// Initialize the start time on first download message
		try {
			const runtimeMap = runtime as unknown as Record<string, unknown>;
			if (typeof runtimeMap[startedAtKey] !== "number" || runtimeMap[startedAtKey] === 0) {
				runtimeMap[startedAtKey] = now();
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
		(runtime as unknown as Record<string, unknown>)[doneMarker] = false;
		return;
	}

	if (status === "start") {
		setEpochProgress(plugin, kind, `${label}… starting`);
		(runtime as unknown as Record<string, unknown>)[doneMarker] = false;
		return;
	}
}

function isWorkerLike(w: unknown): w is Worker {
	return !!w && typeof w === "object" && typeof (w as Worker).postMessage === "function";
}

function describeWorkerFactoryShape(v: unknown): unknown {
	try {
		if (v == null) return { type: "null" };
		const t = typeof v;
		if (t === "function") return { type: "function", name: (v as { name?: string }).name || "(anonymous)" };
		if (t === "string") return { type: "string", len: (v as string).length };
		if (t === "object") return { type: "object", keys: Object.keys(v).slice(0, 20) };
		return { type: t };
	} catch {
		return { type: "unknown" };
	}
}

function createWorkerMaybeModule(WorkerCtor: typeof Worker, url: string): Worker | null {
	if (!WorkerCtor || !url) return null;
	try {
		const w = new WorkerCtor(url, { type: "module" });
		return isWorkerLike(w) ? (w) : null;
	} catch {
		try {
			const w = new WorkerCtor(url);
			return isWorkerLike(w) ? (w) : null;
		} catch {
			return null;
		}
	}
}

function tryCreateWorkerFromFactory(factory: unknown): Worker | null {
	if (!factory) return null;
	const browserWindow = window as BrowserWindowLike;
	const WorkerCtor = browserWindow.Worker ?? browserWindow.window?.Worker;
	if (isWorkerLike(factory)) return factory;
	if (typeof factory === "string" && WorkerCtor) {
		return createWorkerMaybeModule(WorkerCtor, factory);
	}
	if (typeof factory === "function") {
		const workerFactory = factory as WorkerFactoryFn;
		try {
			const w = workerFactory();
			if (isWorkerLike(w)) return w;
		} catch {
			// ignore
		}
		try {
			const w = new workerFactory();
			if (isWorkerLike(w)) return w;
		} catch {
			// ignore
		}
	}
	try {
		const d = (factory as WorkerFactoryFn).default;
		if (d && d !== factory) return tryCreateWorkerFromFactory(d);
	} catch {
		// ignore
	}
	return null;
}

export function getSimilarityWorker(plugin: EpochPlugin): Worker | null {
	const runtime = plugin as unknown as SimilarityWorkerRuntime;
	if (runtime.similarityWorkerDisabled === true) return null;
	const browserWindow = window as BrowserWindowLike;
	const WorkerCtor = browserWindow.Worker ?? browserWindow.window?.Worker;
	if (!WorkerCtor) {
		runtime.similarityWorkerLastCreateError = "Worker is undefined";
		return null;
	}
	if (!embeddingsAllowed()) return null;

	let w: Worker | null = runtime.similarityWorker ?? null;
	if (w) return w;
	try {
		const factory: unknown = SimilarityEmbedWorker;
		const g = browserWindow;
		const originalWorker = g.Worker;
		let spoofedWorker = false;
		let wrappedWorker = false;
		let moduleWorkerCtor: typeof Worker | null = null;
		try {
			if (WorkerCtor) {
				moduleWorkerCtor = function ModuleEpochSimilarityWorker(url: string | URL, options?: WorkerOptions): Worker {
					const merged: WorkerOptions = { ...(options ?? {}), type: "module" };
					return new WorkerCtor(url, merged);
				} as unknown as typeof Worker;
				try {
					moduleWorkerCtor.prototype = WorkerCtor.prototype;
				} catch {
					// ignore
				};
				g.Worker = moduleWorkerCtor;
				wrappedWorker = true;
				if (!originalWorker) spoofedWorker = true;
			}
			w = tryCreateWorkerFromFactory(factory);
		} finally {
			if (wrappedWorker || spoofedWorker) g.Worker = originalWorker;
		}
		if (!w) {
			runtime.similarityWorkerLastCreateError = `Worker factory did not produce a Worker. shape=${safeStringify(describeWorkerFactoryShape(factory), 300)}`;
			return null;
		}
		runtime.similarityWorker = w;
		runtime.similarityWorkerNextId = 1;
		runtime.similarityWorkerLastCreateError = null;
		runtime.similarityWorkerPending = new Map<
			number,
			{ resolve: (v: WorkerEmbedResponse) => void; reject: (e: unknown) => void }
		>();
		w.onmessage = (ev: MessageEvent) => {
			try {
				const raw: unknown = ev?.data;
				const progressRaw = raw as { type?: unknown };
				if (raw && typeof raw === "object" && progressRaw.type === "progress") {
					handleSimilarityWorkerProgress(plugin, raw as SimilarityWorkerProgressMsg);
					return;
				}
				const msg = raw as WorkerEmbedResponse & { id?: unknown; ok?: boolean; error?: unknown };
				const id = Number(msg.id);
				const pending = runtime.similarityWorkerPending;
				const entry = pending?.get(id);
				if (!entry) return;
				pending?.delete(id);
				if (msg.ok === true) {
					entry.resolve(msg);
					return;
				}
				const err = typeof msg.error === "string" ? msg.error : "Worker request failed";
				entry.reject(new Error(err));
			} catch {
				// ignore
			}
		};
		w.onmessageerror = (e: unknown) => {
			try {
				runtime.similarityWorkerLastCrashError = "Worker message deserialization failed";
				runtime.similarityWorkerLastCrashAt = now();
			} catch {
				// ignore
			}
			void e;
		};
		w.onerror = (e: unknown) => {
			try {
				const errEvent = e as ErrorEvent & { lineNumber?: number; columnNumber?: number };
				const errMessage = errEvent.error instanceof Error ? errEvent.error.message : "";
				const msg = String(errEvent.message || errMessage || "Worker crashed");
				const file = String(errEvent.filename || "");
				const line = Number(errEvent.lineno ?? errEvent.lineNumber ?? 0) || 0;
				const col = Number(errEvent.colno ?? errEvent.columnNumber ?? 0) || 0;
				const err = errEvent.error ? safeStringify(errEvent.error, 2000) : null;
				runtime.similarityWorkerLastCrashError = [msg, file ? `@ ${file}:${line}:${col}` : null, err].filter(Boolean).join(" ");
				runtime.similarityWorkerLastCrashAt = now();
				runtime.similarityWorkerLastCrashEvent = safeStringify(
					{ message: msg, filename: file || null, lineno: line || null, colno: col || null },
					800
				);
				const prevAt = Number(runtime.similarityWorkerCrashWindowAt ?? 0);
				const prevCount = Number(runtime.similarityWorkerCrashCount ?? 0);
				const WINDOW_MS = 30_000;
				const within = prevAt > 0 && now() - prevAt < WINDOW_MS;
				runtime.similarityWorkerCrashWindowAt = within ? prevAt : now();
				runtime.similarityWorkerCrashCount = within ? prevCount + 1 : 1;
				if ((runtime.similarityWorkerCrashCount ?? 0) >= 3) {
					runtime.similarityWorkerDisabled = true;
					runtime.similarityWorkerLastCreateError = "Worker disabled after repeated crashes";
				}
			} catch {
				// ignore
			}
			void e;
			try {
				const pending = runtime.similarityWorkerPending;
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
				runtime.similarityWorker = null;
			} catch {
				// ignore
			}
			return true;
		};
		return w;
	} catch (e: unknown) {
		const err = e instanceof Error ? e.message : "Worker creation failed";
		runtime.similarityWorkerLastCreateError = err;
		return null;
	}
}
