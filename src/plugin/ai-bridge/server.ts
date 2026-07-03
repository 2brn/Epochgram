import { Platform } from "obsidian";
import type { EpochPlugin } from "../../main";
import { buildAiBridgePageHtml } from "../ai-bridge-page";
import { applyBridgeCorsHeaders, getQueryToken, readBody, safeJson, sendHtml } from "./http-helpers";
import { sanitizeBridgeOptions, sanitizeBridgeServerState, validateBridgeOptionsYaml } from "./sanitize";
import { estimateTokens } from "./tokens";
import type { AiBridgeStatus, AiSummaryJob, AiSummaryJobResult } from "./types";

type RuntimeGlobalLike = typeof window & {
	__epochNodeHttpModule?: string;
	__epochAiBridgeLastCloseAt?: number;
	require?: (moduleName: string) => unknown;
};

type RequestLike = {
	headers?: Record<string, string | string[] | undefined>;
	url?: string;
	method?: string;
	on(event: "data", listener: (chunk: unknown) => void): void;
	on(event: "end", listener: () => void): void;
	on(event: "error", listener: (error: Error) => void): void;
};

type ResponseLike = {
	statusCode: number;
	setHeader(name: string, value: string): void;
	end(body?: string): void;
	on(event: "end" | "close", listener: () => void): void;
	resume(): void;
};

type ServerAddressLike = { port?: unknown } | string | null;

type ServerLike = {
	once(event: "error", listener: (err: unknown) => void): void;
	listen(port: number, host: string, listener: () => void): void;
	address(): ServerAddressLike;
	close(callback: () => void): void;
};

type HttpModuleLike = {
	createServer(handler: (req: RequestLike, res: ResponseLike) => void): ServerLike;
	request(
		options: {
			method: string;
			hostname: string;
			port: number;
			path: string;
			headers: Record<string, string | number>;
		},
		listener: (res: ResponseLike) => void
	): {
		on(event: "error", listener: () => void): void;
		write(data: string): void;
		end(): void;
	};
};

type EpochJobExtras = {
	epochBucket?: string;
	epochStart?: string;
	epochEnd?: string;
	groupType?: string;
	groupDate?: string;
	chunkIndex?: number;
	chunkCount?: number;
};

type EnqueueThrottleState = {
	timerId?: unknown;
	pendingJobs?: unknown;
};

type EnqueueThrottleMap = {
	values: () => Iterable<unknown>;
	clear: () => void;
};

type ServerPluginRuntime = {
	saveSettings?: () => Promise<void> | void;
	onAiBridgeOptionsChanged?: (prev: Record<string, unknown>, next: Record<string, unknown>) => void;
	__epochEpochHierarchyRunKey?: number;
	__epochEpochHierarchyTotalJobs?: number;
	__epochEpochHierarchyTotalTokens?: number;
	__epochAiEnqueueCancelKey?: number;
	aiSummaryPendingFiles?: Set<string>;
	aiSummaryQueueRunning?: boolean;
	epochRegenAfterAiTimer?: number | null;
	epochRegenAfterAiMode?: unknown;
	epochRegenAfterAiAll?: boolean;
	epochRegenAfterAiDateKeys?: unknown;
	epochRegenAfterAiBuckets?: unknown;
	epochRegenAfterAiBucketsQueue?: unknown;
	epochRegenAfterAiShowQueuedNotice?: boolean;
	__epochAiEpochsProgressStartedAt?: number;
	__epochAiEpochsProgressBaselineDone?: number;
	__epochAiEpochsProgressBaselineErrors?: number;
	aiSummaryEnqueueThrottleByFile?: EnqueueThrottleMap;
	aiBridgeChunkGroups?: { clear?: () => void };
	aiBridgeReduceFallbackByJobId?: { clear?: () => void };
	refreshAiBridgeStatusBar?: () => void;
	refreshAiBridgeProgress?: () => void;
};

const runtimeGlobal = window as RuntimeGlobalLike;

function normalizeHttpModuleName(moduleName: string): string {
	const value = String(moduleName || "").trim();
	if (!value) return "http";
	return value === "node:http" ? "http" : value;
}

async function importHttpModule(): Promise<HttpModuleLike> {
	if (Platform.isDesktop) {
		return (await import("http")) as unknown as HttpModuleLike;
	}
	throw new Error("http import is desktop-only");
}

function clearIntervalHandle(handle: unknown): void {
	(window.clearInterval as unknown as (id: unknown) => void)(handle);
}

function clearTimeoutHandle(handle: unknown): void {
	(window.clearTimeout as unknown as (id: unknown) => void)(handle);
}

function getJobExtras(job: AiSummaryJob): EpochJobExtras {
	return job;
}

function getPluginRuntime(plugin: EpochPlugin): ServerPluginRuntime {
	return plugin;
}

function makeBridgeToken(): string {
	const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
	const bytes = new Uint8Array(24);
	try {
		const c = runtimeGlobal.crypto;
		if (c && typeof c.getRandomValues === "function") {
			c.getRandomValues(bytes);
		} else {
			for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
		}
	} catch {
		for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
	}
	let s = "";
	for (let i = 0; i < bytes.length; i++) {
		const byte = bytes[i] ?? 0;
		s += alphabet[byte % alphabet.length];
	}
	return `${Date.now().toString(36)}-${s}`;
}

type AiBridgeServerState = {
	token: string;
	port?: number;
};

export class AiBridgeServer {
	private server: ServerLike | null = null;
	private token: string;
	private port: number | null = null;
	private preferredPort: number | null = null;

	private pending: AiSummaryJob[] = [];
	private inProgress = new Map<string, AiSummaryJob>();
	private done = 0;
	private errors = 0;
	private doneEpoch = 0;
	private errorsEpoch = 0;
	private pendingTokens = 0;
	private inProgressTokens = 0;
	private doneTokens = 0;
	private errorTokens = 0;
	private doneEpochTokens = 0;
	private errorEpochTokens = 0;
	private epochRunKey = 0;
	private lastError: string | null = null;
	private lastClientSeenAt = 0;
	private optionsPersistTimer: number | null = null;
	private serverPersistTimer: number | null = null;

	private isClientConnected(): boolean {
		if (!(this.lastClientSeenAt > 0)) return false;
		const ageMs = Date.now() - this.lastClientSeenAt;
		const hasWork = this.pending.length > 0 || this.inProgress.size > 0;
		// When idle, tolerate browser timer throttling so an already-open bridge tab
		// doesn't flap to "disconnected" and cause duplicate opens.
		const thresholdMs = hasWork ? 15_000 : 120_000;
		return ageMs < thresholdMs;
	}

	constructor(
		private plugin: EpochPlugin,
		private onResult: (job: AiSummaryJob, result: AiSummaryJobResult) => void
	) {
		const saved = sanitizeBridgeServerState(this.plugin.settings.aiBridgeServer);
		this.token = saved?.token ?? makeBridgeToken();
		this.preferredPort = typeof saved?.port === "number" ? saved.port : null;
	}

	rebind(plugin: EpochPlugin, onResult: (job: AiSummaryJob, result: AiSummaryJobResult) => void): void {
		this.plugin = plugin;
		this.onResult = onResult;
		// Note: token/port are intentionally preserved to keep existing bridge tabs stable.
		// Timers continue running; subsequent persistence will use the new plugin instance.
	}

	private persistServerState(nextPort: number | null): void {
		const payload: AiBridgeServerState = {
			token: this.token,
			...(typeof nextPort === "number" && Number.isFinite(nextPort) ? { port: nextPort } : {})
		};
		this.plugin.settings.aiBridgeServer = payload;
		if (this.serverPersistTimer) {
			window.clearTimeout(this.serverPersistTimer);
			this.serverPersistTimer = null;
		}
		try {
			const runtime = getPluginRuntime(this.plugin);
			if (typeof runtime.saveSettings === "function") {
				void runtime.saveSettings();
			}
		} catch { void 0; }
	}

	private makeJobDedupKey(job: AiSummaryJob): string {
		const extras = getJobExtras(job);
		const kind = String(job?.kind || "");
		if (kind === "epoch") {
			const bucket = String(extras.epochBucket || "");
			const start = String(extras.epochStart || job?.date || "");
			const end = String(extras.epochEnd || "");
			const base = ["epoch", bucket, start, end, String(job?.filePath || "")].join("|");
			const chunkIndex = typeof extras.chunkIndex === "number" ? extras.chunkIndex : null;
			const chunkCount = typeof extras.chunkCount === "number" ? extras.chunkCount : null;
			if (chunkIndex != null && chunkCount != null && chunkCount > 1) {
				return `${base}|c:${chunkIndex}/${chunkCount}`;
			}
			return base;
		}

		const base = [
			kind,
			String(job?.filePath || ""),
			String(job?.date || ""),
			String(job?.blockStart ?? ""),
			String(job?.blockEnd ?? ""),
			String(job?.source || "")
		].join("|");

		const group = [
			String(job?.groupId || ""),
			String(job?.chunkIndex ?? ""),
			String(job?.chunkCount ?? ""),
			String(job?.groupType || ""),
			String(job?.groupDate || "")
		].join("|");

		let targets = "";
		if (Array.isArray(job?.targets) && job.targets.length > 0) {
			const t = job.targets
				.map((x) => [x?.kind || "", x?.date || "", x?.blockStart ?? "", x?.blockEnd ?? "", x?.source || ""].join("~"))
				.sort()
				.join(",");
			targets = t;
		}

		return targets ? `${base}|g:${group}|t:${targets}` : `${base}|g:${group}`;
	}

	private makeJobReplaceKey(job: AiSummaryJob): string {
		const extras = getJobExtras(job);
		const kind = String(job?.kind || "");
		if (kind === "epoch") return this.makeJobDedupKey(job);

		const groupType = String(extras.groupType ?? "");
		if (groupType) {
			const filePath = String(job?.filePath || "");
			const rawGroupDate = String(extras.groupDate ?? job?.date ?? "");
			const groupDate = groupType === "anchor" ? "anchor" : rawGroupDate;
			return ["summary", filePath, groupType, groupDate].join("|");
		}

		// Fallback for older/special jobs without grouping.
		return this.makeJobDedupKey(job);
	}

	private dedupePendingKeepLatest(): void {
		if (this.pending.length <= 1) return;
		const kept: AiSummaryJob[] = [];
		const seen = new Set<string>();
		for (let i = this.pending.length - 1; i >= 0; i--) {
			const j = this.pending[i];
			if (!j) continue;
			const key = this.makeJobDedupKey(j);
			if (seen.has(key)) continue;
			seen.add(key);
			kept.push(j);
		}
		kept.reverse();
		this.pending = kept;
		this.pendingTokens = 0;
		for (const j of this.pending) this.pendingTokens += estimateTokens(j.input);
	}

	private getBridgeOptions(): Record<string, unknown> {
		const o = this.plugin.settings.aiBridgeOptions;
		return o && typeof o === "object" ? o : {};
	}

	private setBridgeOptions(next: Record<string, unknown>): void {
		const runtime = getPluginRuntime(this.plugin);
		const prev = this.getBridgeOptions();
		this.plugin.settings.aiBridgeOptions = next;
		try {
			runtime.onAiBridgeOptionsChanged?.(prev, next);
		} catch { void 0; }
		if (this.optionsPersistTimer) {
			window.clearTimeout(this.optionsPersistTimer);
			this.optionsPersistTimer = null;
		}
		this.optionsPersistTimer = window.setTimeout(() => {
			this.optionsPersistTimer = null;
			try {
				void this.plugin.saveSettings();
			} catch { void 0; }
		}, 350);
	}

	getUrl(options?: { closeOnDisconnect?: boolean }): string {
		const port = this.port ?? 0;
		const base = `http://127.0.0.1:${port}/?token=${encodeURIComponent(this.token)}`;
		if (options?.closeOnDisconnect === true) return base + "&closeOnDisconnect=1";
		return base;
	}

	getStatus(): AiBridgeStatus {
		const runtime = getPluginRuntime(this.plugin);
		const nextRunKey = (() => {
			try {
				const n = Number(runtime.__epochEpochHierarchyRunKey ?? 0);
				return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
			} catch {
				return 0;
			}
		})();
		if (nextRunKey !== this.epochRunKey) {
			this.epochRunKey = nextRunKey;
			this.doneEpoch = 0;
			this.errorsEpoch = 0;
			this.doneEpochTokens = 0;
			this.errorEpochTokens = 0;
		}

		let epochTotal: number | null = null;
		try {
			const n = Number(runtime.__epochEpochHierarchyTotalJobs ?? 0);
			epochTotal = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
		} catch {
			epochTotal = null;
		}

		let epochTotalTokens: number | null = null;
		try {
			const n = Number(runtime.__epochEpochHierarchyTotalTokens ?? 0);
			epochTotalTokens = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
		} catch {
			epochTotalTokens = null;
		}

		const epochProcessed = Math.max(0, this.doneEpoch + this.errorsEpoch);

		// If we don't have a planned total, fall back to the current epoch queue size.
		// This keeps the bridge page informative for single-bucket epoch runs.
		let epochQueued = 0;
		let epochQueuedTokens = 0;
		let epochInProgressTokens = 0;
		try {
			for (const j of this.pending) {
				if (j.kind !== "epoch") continue;
				epochQueued++;
				epochQueuedTokens += estimateTokens(String(j.input ?? ""));
			}
			for (const j of this.inProgress.values()) {
				if (j.kind !== "epoch") continue;
				epochQueued++;
				epochInProgressTokens += estimateTokens(String(j.input ?? ""));
			}
		} catch {
			epochQueued = 0;
			epochQueuedTokens = 0;
			epochInProgressTokens = 0;
		}
		if (epochTotal == null && epochQueued > 0) {
			epochTotal = Math.max(1, epochProcessed + epochQueued);
		}
		if (epochTotal == null && epochQueued === 0 && epochProcessed > 0) {
			epochTotal = Math.max(1, epochProcessed);
		}
		if (epochTotalTokens == null && (epochQueuedTokens + epochInProgressTokens) > 0) {
			const epochProcessedTokens = this.doneEpochTokens + this.errorEpochTokens;
			epochTotalTokens = Math.max(1, epochProcessedTokens + epochQueuedTokens + epochInProgressTokens);
		}
		if (epochTotalTokens == null && epochQueued === 0 && epochProcessed > 0) {
			const epochProcessedTokens = this.doneEpochTokens + this.errorEpochTokens;
			if (epochProcessedTokens > 0) epochTotalTokens = Math.max(1, epochProcessedTokens);
		}

		const epochRemaining = epochTotal != null ? Math.max(0, epochTotal - epochProcessed) : null;
		const epochProcessedTokens = this.doneEpochTokens + this.errorEpochTokens;
		const epochRemainingTokens = epochTotalTokens != null ? Math.max(0, epochTotalTokens - epochProcessedTokens) : null;

		return {
			clientConnected: this.isClientConnected(),
			queued: this.pending.length,
			inProgress: this.inProgress.size,
			done: this.done,
			errors: this.errors,
			queuedTokens: this.pendingTokens,
			inProgressTokens: this.inProgressTokens,
			processedTokens: this.doneTokens,
			errorTokens: this.errorTokens,
			lastError: this.lastError,
			...(epochTotal != null
				? {
					epochTotal,
					epochProcessed,
					epochRemaining: epochRemaining ?? 0,
					...(epochTotalTokens != null
						? {
							epochTotalTokens,
							epochQueuedTokens,
							epochInProgressTokens,
							epochProcessedTokens,
							epochRemainingTokens: epochRemainingTokens ?? 0
						}
						: {})
				}
				: {})
		};
	}

	clearQueue(): void {
		this.clearQueueInternal();
	}

	private clearQueueInternal(): void {
		this.pending = [];
		this.inProgress.clear();
		this.pendingTokens = 0;
		this.inProgressTokens = 0;

		// Also clear any plugin-side deferred/planned enqueue work.
		// Example: epoch regeneration scheduled to run after AI becomes idle.
		try {
			const runtime = getPluginRuntime(this.plugin);
			try {
				// Cancels in-flight producers that are still enqueueing jobs.
				runtime.__epochAiEnqueueCancelKey = (Number(runtime.__epochAiEnqueueCancelKey) || 0) + 1;
			} catch { void 0; }
			try {
				runtime.aiSummaryPendingFiles = new Set<string>();
				runtime.aiSummaryQueueRunning = false;
			} catch { void 0; }

			// Cancel epoch regeneration that was deferred until AI is idle.
			if (runtime.epochRegenAfterAiTimer != null) {
				try {
					clearIntervalHandle(runtime.epochRegenAfterAiTimer);
				} catch { void 0; }
				runtime.epochRegenAfterAiTimer = null;
			}
			runtime.epochRegenAfterAiMode = null;
			runtime.epochRegenAfterAiAll = false;
			runtime.epochRegenAfterAiDateKeys = null;
			runtime.epochRegenAfterAiBuckets = null;
			runtime.epochRegenAfterAiBucketsQueue = null;
			runtime.epochRegenAfterAiShowQueuedNotice = false;
			runtime.__epochEpochHierarchyTotalJobs = 0;
			runtime.__epochEpochHierarchyTotalTokens = 0;
			runtime.__epochEpochHierarchyRunKey = 0;
			runtime.__epochAiEpochsProgressStartedAt = 0;
			runtime.__epochAiEpochsProgressBaselineDone = 0;
			runtime.__epochAiEpochsProgressBaselineErrors = 0;

			// Cancel any per-file throttled enqueues (jobs scheduled for later).
			const throttle = runtime.aiSummaryEnqueueThrottleByFile;
			if (throttle && typeof throttle.values === "function" && typeof throttle.clear === "function") {
				try {
					for (const st of throttle.values()) {
						try {
							if (typeof st === "object" && st !== null) {
								const state = st as EnqueueThrottleState;
								if (state.timerId != null) clearTimeoutHandle(state.timerId);
							}
						} catch { void 0; }
						try {
							if (typeof st === "object" && st !== null) {
								const state = st as EnqueueThrottleState;
								state.timerId = null;
								state.pendingJobs = null;
							}
						} catch { void 0; }
					}
					throttle.clear();
				} catch { void 0; }
			}

			// Drop reduce/chunk aggregation state so it can't enqueue follow-up reduce jobs.
			try {
				runtime.aiBridgeChunkGroups?.clear?.();
			} catch { void 0; }
			try {
				runtime.aiBridgeReduceFallbackByJobId?.clear?.();
			} catch { void 0; }
		} catch {
			// ignore
		}

		this.doneEpochTokens = 0;
		this.errorEpochTokens = 0;
		this.doneEpoch = 0;
		this.errorsEpoch = 0;

		try {
			getPluginRuntime(this.plugin).refreshAiBridgeStatusBar?.();
		} catch {
			// ignore
		}
		try {
			getPluginRuntime(this.plugin).refreshAiBridgeProgress?.();
		} catch {
			// ignore
		}
	}

	async start(): Promise<void> {
		if (this.server) return;
		if (!Platform.isDesktop) {
			throw new Error("AI Bridge server is only available on desktop");
		}
		const httpModule = normalizeHttpModuleName(runtimeGlobal.__epochNodeHttpModule ?? "http");
		const moduleRequire = runtimeGlobal.require;
		const http = typeof moduleRequire === "function"
			? (moduleRequire(httpModule) as HttpModuleLike)
			: (await importHttpModule());

		this.server = http.createServer((req: RequestLike, res: ResponseLike) => {
			void (async () => {
				try {
					const runtime = getPluginRuntime(this.plugin);
					const token = getQueryToken(req);
					const pathName = (() => {
						try {
							const u = new URL(req.url ?? "/", "http://127.0.0.1");
							return u.pathname;
						} catch {
							return "/";
						}
					})();

				// CORS: allow only loopback (bridge tab) + Obsidian app origin.
				// All API requests are token-gated.
					if (pathName.startsWith("/api/")) {
					try {
						applyBridgeCorsHeaders(req, res);
					} catch {
						// ignore
					}
						if (req.method === "OPTIONS") {
						res.statusCode = 204;
						res.end();
						return;
					}
					}

					if (pathName === "/") {
					if (token !== this.token) {
						res.statusCode = 403;
						res.end("Forbidden");
						return;
					}
					sendHtml(res, buildAiBridgePageHtml(this.token));
					return;
				}

				if (!pathName.startsWith("/api/")) {
					res.statusCode = 404;
					res.end("Not found");
					return;
				}

				if (token !== this.token) {
					safeJson(req, res, 403, { error: "forbidden" });
					return;
				}

				// NOTE: lastClientSeenAt is meant to track the browser bridge page connection.
				// Do not update it for plugin-initiated maintenance calls like /api/clearQueue;
				// otherwise the plugin can mistakenly think the bridge page is already open.

				if (pathName === "/api/bye") {
					if (req.method !== "POST") {
						safeJson(req, res, 405, { error: "method not allowed" });
						return;
					}
					// Best-effort: the bridge page is closing. Mark it disconnected immediately
					// so subsequent actions can re-open Chrome without waiting for the stale
					// connection timeout.
					this.lastClientSeenAt = 0;
					try {
						runtime.refreshAiBridgeStatusBar?.();
					} catch {
						// ignore
					}
					try {
						runtime.refreshAiBridgeProgress?.();
					} catch {
						// ignore
					}
					try {
						runtimeGlobal.__epochAiBridgeLastCloseAt = Date.now();
					} catch {
						// ignore
					}
					safeJson(req, res, 200, { ok: true });
					return;
				}

				if (pathName === "/api/status") {
					if (req.method !== "GET") {
						safeJson(req, res, 405, { error: "method not allowed" });
						return;
					}
					this.lastClientSeenAt = Date.now();
					try {
						runtime.refreshAiBridgeStatusBar?.();
					} catch {
						// ignore
					}
					try {
						runtime.refreshAiBridgeProgress?.();
					} catch {
						// ignore
					}
					safeJson(req, res, 200, this.getStatus());
					return;
				}

				if (pathName === "/api/options") {
					if (req.method === "GET") {
						safeJson(req, res, 200, this.getBridgeOptions());
						return;
					}
					if (req.method === "POST") {
						const raw = await readBody(req);
						let body: unknown = {};
						try {
							body = JSON.parse(raw || "{}");
						} catch {
							// ignore
						}
						const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
						this.setBridgeOptions(sanitizeBridgeOptions(obj));
						safeJson(req, res, 200, { ok: true });
						return;
					}
					safeJson(req, res, 405, { error: "method not allowed" });
					return;
				}

				if (pathName === "/api/options/validate") {
					if (req.method !== "POST") {
						safeJson(req, res, 405, { error: "method not allowed" });
						return;
					}
					const raw = await readBody(req);
						let body: unknown = {};
					try {
						body = JSON.parse(raw || "{}");
					} catch {
						// ignore
					}
						const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
						const checked = validateBridgeOptionsYaml(typeof obj.settingsYaml === "string" ? obj.settingsYaml : "");
					safeJson(req, res, 200, {
						ok: checked.valid,
						errors: checked.errors,
						warnings: checked.warnings,
						formattedUserYaml: checked.formattedUserYaml,
						formattedMergedYaml: checked.formattedMergedYaml,
						resolved: checked.resolved,
						stored: checked.stored
					});
					return;
				}

				if (pathName === "/api/nextJob") {
					if (req.method !== "GET") {
						safeJson(req, res, 405, { error: "method not allowed" });
						return;
					}
					this.lastClientSeenAt = Date.now();
					try {
						runtime.refreshAiBridgeStatusBar?.();
					} catch {
						// ignore
					}
					try {
						runtime.refreshAiBridgeProgress?.();
					} catch {
						// ignore
					}
					const next = this.pending.shift() ?? null;
					if (!next) {
						// If a previous bridge tab claimed a job and then crashed/closed before
						// submitting a result, the job will remain "in progress" forever.
						// Allow a newly-opened/reloaded bridge page to resume by returning an
						// existing in-progress job when the pending queue is empty.
						const stuck = this.inProgress.size > 0 ? (this.inProgress.values().next().value ?? null) : null;
						safeJson(req, res, 200, stuck);
						return;
					}
					{
						const tok = estimateTokens(next.input);
						this.pendingTokens = Math.max(0, this.pendingTokens - tok);
						this.inProgressTokens += tok;
					}
					this.inProgress.set(next.id, next);
					safeJson(req, res, 200, next);
					return;
				}

				if (req.method === "POST" && pathName === "/api/submitResult") {
					this.lastClientSeenAt = Date.now();
					try {
						runtime.refreshAiBridgeStatusBar?.();
					} catch {
						// ignore
					}
					try {
						runtime.refreshAiBridgeProgress?.();
					} catch {
						// ignore
					}
					const raw = await readBody(req);
					let body: unknown = {};
					try {
						body = JSON.parse(raw || "{}");
					} catch { void 0; }
					const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
					const id = typeof obj.id === "string" ? obj.id : null;
					const error = typeof obj.error === "string" ? obj.error : null;
					if (!id) {
						if (error) {
							this.errors++;
							this.lastError = error;
						}
						safeJson(req, res, 200, { ok: true });
						return;
					}
					const job = this.inProgress.get(id) ?? null;
					if (!job) {
						safeJson(req, res, 200, { ok: true, ignored: true });
						return;
					}
					this.inProgress.delete(id);
					if (error) {
						this.errors++;
						if (job.kind === "epoch") this.errorsEpoch++;
						{
							const tok = estimateTokens(job.input);
							this.inProgressTokens = Math.max(0, this.inProgressTokens - tok);
							this.errorTokens += tok;
							if (job.kind === "epoch") this.errorEpochTokens += tok;
						}
						this.lastError = error;
						try {
							this.onResult(job, { id, error });
						} catch { void 0; }
						safeJson(req, res, 200, { ok: true });
						return;
					}
					const summary = typeof obj.summary === "string" ? obj.summary : "";
					const outputChars = typeof obj.outputChars === "number" ? obj.outputChars : undefined;
					this.done++;
					if (job.kind === "epoch") this.doneEpoch++;
					this.lastError = null;
					{
						const tok = estimateTokens(job.input);
						this.inProgressTokens = Math.max(0, this.inProgressTokens - tok);
						this.doneTokens += tok;
						if (job.kind === "epoch") this.doneEpochTokens += tok;
					}
					try {
						this.onResult(job, { id, summary, outputChars });
					} catch (err: unknown) {
						this.errors++;
						this.lastError = err instanceof Error ? err.message : String(err);
					}
					safeJson(req, res, 200, { ok: true });
					return;
				}

				if (pathName.startsWith("/api/") && req.method === "POST") {
					const normalized = pathName.replace(/\/+$/g, "");
					if (normalized === "/api/clearQueue") {
						this.clearQueueInternal();
						safeJson(req, res, 200, { ok: true });
						return;
					}
				}

				safeJson(req, res, 404, { error: "not found", method: req.method ?? "", path: pathName });
			} catch (err: unknown) {
				this.lastError = err instanceof Error ? err.message : String(err);
				safeJson(req, res, 500, { error: this.lastError });
			}
		})();
		});

		const listenOnce = (port: number): Promise<number> => {
			return new Promise<number>((resolve, reject) => {
				let settled = false;
				this.server!.once("error", (err: unknown) => {
					if (settled) return;
					settled = true;
					const e = err instanceof Error ? err : new Error(String(err));
					reject(e);
				});
				this.server!.listen(port, "127.0.0.1", () => {
					if (settled) return;
					settled = true;
					const addr = this.server!.address();
					const boundPort = typeof addr === "object" && addr !== null && typeof addr.port === "number" ? addr.port : port;
					resolve(boundPort);
				});
			});
		};

		let bound: number | null = null;
		if (this.preferredPort != null) {
			const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
			const preferred = this.preferredPort;
			let lastErr: Error | null = null;
			for (let attempt = 0; attempt < 12; attempt++) {
				try {
					bound = await listenOnce(preferred);
					lastErr = null;
					break;
				} catch (err: unknown) {
					lastErr = err instanceof Error ? err : new Error(String(err));
					const rawCode = typeof err === "object" && err !== null && "code" in err
						? (err as { code?: unknown }).code
						: undefined;
					const code = typeof rawCode === "string" ? rawCode : typeof rawCode === "number" ? String(rawCode) : "";
					// During plugin hot-reload, the previous server may release the port slightly later.
					// Prefer keeping the port stable (so an already-open Chrome tab can reconnect).
					if (code === "EADDRINUSE" || code === "EACCES") {
						await sleep(250);
						continue;
					}
					break;
				}
			}

			if (lastErr) {
				bound = await listenOnce(0);
			}
		} else {
			bound = await listenOnce(0);
		}
		if (bound == null) bound = await listenOnce(0);
		this.port = typeof bound === "number" ? bound : null;
		this.preferredPort = this.port;
		this.persistServerState(this.port);
	}

	async stop(): Promise<void> {
		if (!this.server) return;
		const s = this.server;
		this.server = null;
		await new Promise<void>((resolve: (value: void) => void) => {
			const closeCallback = () => resolve();
			s.close(closeCallback);
		});
		this.port = null;
		this.pending = [];
		this.pendingTokens = 0;
		this.inProgress.clear();
		this.inProgressTokens = 0;
		this.doneTokens = 0;
		this.errorTokens = 0;
		this.doneEpochTokens = 0;
		this.errorEpochTokens = 0;
		this.epochRunKey = 0;
		this.lastClientSeenAt = 0;
		try {
			getPluginRuntime(this.plugin).refreshAiBridgeStatusBar?.();
		} catch {
			// ignore
		}
		try {
			getPluginRuntime(this.plugin).refreshAiBridgeProgress?.();
		} catch {
			// ignore
		}
		if (this.optionsPersistTimer) {
			window.clearTimeout(this.optionsPersistTimer);
			this.optionsPersistTimer = null;
		}
		if (this.serverPersistTimer) {
			window.clearTimeout(this.serverPersistTimer);
			this.serverPersistTimer = null;
		}
	}

	enqueue(jobs: AiSummaryJob[]): void {
		if (!Array.isArray(jobs) || jobs.length === 0) return;

		// Remove older duplicates so re-queuing doesn't double-process.
		// This applies to both pending and in-progress jobs.
		const incomingKeys = new Set<string>();
		for (const j of jobs) {
			incomingKeys.add(this.makeJobReplaceKey(j));
		}

		if (incomingKeys.size > 0) {
			if (this.pending.length > 0) {
				this.pending = this.pending.filter((j) => !incomingKeys.has(this.makeJobReplaceKey(j)));
				this.pendingTokens = 0;
				for (const j of this.pending) this.pendingTokens += estimateTokens(j.input);
			}

			if (this.inProgress.size > 0) {
				for (const [id, j] of Array.from(this.inProgress.entries())) {
					if (incomingKeys.has(this.makeJobReplaceKey(j))) {
						this.inProgress.delete(id);
					}
				}
				this.inProgressTokens = 0;
				for (const j of this.inProgress.values()) this.inProgressTokens += estimateTokens(j.input);
			}
		}

		for (const j of jobs) {
			this.pending.push(j);
			this.pendingTokens += estimateTokens(j.input);
		}
		this.dedupePendingKeepLatest();
		try {
			getPluginRuntime(this.plugin).refreshAiBridgeStatusBar?.();
		} catch {
			// ignore
		}
		try {
			getPluginRuntime(this.plugin).refreshAiBridgeProgress?.();
		} catch {
			// ignore
		}
	}

	async openInChrome(options?: { closeOnDisconnect?: boolean }): Promise<void> {
		const { openAiBridgeInChrome } = await import("./chrome");
		openAiBridgeInChrome(this.getUrl(options));
	}
}
