export const AI_BRIDGE_SCRIPT_PART1_CHUNK_A = String.raw`
	function safeGetLocalStorage(key) {
		try { return window.localStorage.getItem(key); } catch { return null; }
	}
	function safeSetLocalStorage(key, value) {
		try { window.localStorage.setItem(key, value); } catch {}
	}

	function makeDefaultOptionsState() {
		return {
			summaryCtxTemplate: DEFAULTS.summaryCtxTemplate,
			epochCtxTemplate: DEFAULTS.epochCtxTemplate,
			summaryOutputLanguage: "en",
			summaryExpectedInputLanguages: ["en", "ja", "es"],
			summaryExpectedContextLanguages: ["en"],
			summaryType: "headline",
			summaryLength: "long",
			epochOutputLanguage: "en",
			epochExpectedInputLanguages: ["en", "ja", "es"],
			epochExpectedContextLanguages: ["en"],
			epochType: "key-points",
			epochLength: "short"
		};
	}

	function safeArray(raw) {
		return Array.isArray(raw) ? raw : null;
	}

	function normalizeSupportedLanguageList(raw, fallbackArr) {
		const arr = safeArray(raw) || (typeof raw === "string" && raw ? [raw] : []);
		const out = [];
		const seen = new Set();
		for (const item of arr) {
			const n = normalizeSupportedLanguage(item);
			if (seen.has(n)) continue;
			seen.add(n);
			out.push(n);
		}
		if (out.length) return out;
		const fb = Array.isArray(fallbackArr) && fallbackArr.length ? fallbackArr : ["en"];
		return normalizeSupportedLanguageList(fb, ["en"]);
	}

	function normalizeSummarizerType(raw) {
		const v = typeof raw === "string" ? raw : "";
		if (v === "tldr" || v === "teaser" || v === "key-points" || v === "headline") return v;
		return "headline";
	}

	function normalizeSummarizerLength(raw) {
		const v = typeof raw === "string" ? raw : "";
		if (v === "short" || v === "medium" || v === "long") return v;
		return "long";
	}

	function readMultiSelectValues(el) {
		try {
			if (!el) return [];
			const out = [];
			const opts = el.selectedOptions ? Array.from(el.selectedOptions) : [];
			for (const o of opts) {
				if (!o || o.value == null) continue;
				out.push(String(o.value));
			}
			return out;
		} catch {
			return [];
		}
	}

	function setMultiSelectValues(el, values) {
		try {
			if (!el) return;
			const set = new Set(Array.isArray(values) ? values.map(v => String(v)) : []);
			for (const opt of Array.from(el.options || [])) {
				try { opt.selected = set.has(String(opt.value)); } catch {}
			}
		} catch {
		}
	}

	function normalizeOptionsState(raw) {
		const state = makeDefaultOptionsState();
		if (!raw || typeof raw !== "object") return state;
		if (typeof raw.summaryCtxTemplate === "string") state.summaryCtxTemplate = raw.summaryCtxTemplate;
		if (typeof raw.epochCtxTemplate === "string") state.epochCtxTemplate = raw.epochCtxTemplate;
		if (typeof raw.summaryOutputLanguage === "string") state.summaryOutputLanguage = raw.summaryOutputLanguage;
		if (raw.summaryExpectedInputLanguages != null) state.summaryExpectedInputLanguages = raw.summaryExpectedInputLanguages;
		if (raw.summaryExpectedContextLanguages != null) state.summaryExpectedContextLanguages = raw.summaryExpectedContextLanguages;
		if (typeof raw.summaryType === "string") state.summaryType = raw.summaryType;
		if (typeof raw.summaryLength === "string") state.summaryLength = raw.summaryLength;
		if (typeof raw.epochOutputLanguage === "string") state.epochOutputLanguage = raw.epochOutputLanguage;
		if (raw.epochExpectedInputLanguages != null) state.epochExpectedInputLanguages = raw.epochExpectedInputLanguages;
		if (raw.epochExpectedContextLanguages != null) state.epochExpectedContextLanguages = raw.epochExpectedContextLanguages;
		if (typeof raw.epochType === "string") state.epochType = raw.epochType;
		if (typeof raw.epochLength === "string") state.epochLength = raw.epochLength;
		try {
			state.summaryOutputLanguage = normalizeSupportedLanguage(state.summaryOutputLanguage);
			state.summaryExpectedInputLanguages = normalizeSupportedLanguageList(state.summaryExpectedInputLanguages, ["en", "ja", "es"]);
			state.summaryExpectedContextLanguages = normalizeSupportedLanguageList(state.summaryExpectedContextLanguages, ["en"]);
			state.summaryType = normalizeSummarizerType(state.summaryType);
			state.summaryLength = normalizeSummarizerLength(state.summaryLength);
			state.epochOutputLanguage = normalizeSupportedLanguage(state.epochOutputLanguage);
			state.epochExpectedInputLanguages = normalizeSupportedLanguageList(state.epochExpectedInputLanguages, ["en", "ja", "es"]);
			state.epochExpectedContextLanguages = normalizeSupportedLanguageList(state.epochExpectedContextLanguages, ["en"]);
			state.epochType = normalizeSummarizerType(state.epochType);
			state.epochLength = normalizeSummarizerLength(state.epochLength);
		} catch {}
		return state;
	}

	function mergeOptionsState(localRaw, savedRaw) {
		const out = makeDefaultOptionsState();
		const apply = (raw) => {
			if (!raw || typeof raw !== "object") return;
			if (typeof raw.summaryCtxTemplate === "string") out.summaryCtxTemplate = raw.summaryCtxTemplate;
			if (typeof raw.epochCtxTemplate === "string") out.epochCtxTemplate = raw.epochCtxTemplate;
			if (typeof raw.summaryOutputLanguage === "string") out.summaryOutputLanguage = raw.summaryOutputLanguage;
			if (raw.summaryExpectedInputLanguages != null) out.summaryExpectedInputLanguages = raw.summaryExpectedInputLanguages;
			if (raw.summaryExpectedContextLanguages != null) out.summaryExpectedContextLanguages = raw.summaryExpectedContextLanguages;
			if (typeof raw.summaryType === "string") out.summaryType = raw.summaryType;
			if (typeof raw.summaryLength === "string") out.summaryLength = raw.summaryLength;
			if (typeof raw.epochOutputLanguage === "string") out.epochOutputLanguage = raw.epochOutputLanguage;
			if (raw.epochExpectedInputLanguages != null) out.epochExpectedInputLanguages = raw.epochExpectedInputLanguages;
			if (raw.epochExpectedContextLanguages != null) out.epochExpectedContextLanguages = raw.epochExpectedContextLanguages;
			if (typeof raw.epochType === "string") out.epochType = raw.epochType;
			if (typeof raw.epochLength === "string") out.epochLength = raw.epochLength;
		};
		apply(localRaw);
		apply(savedRaw);
		return normalizeOptionsState(out);
	}

	function loadOptionsState() {
		const raw = safeGetLocalStorage(OPTS_KEY);
		if (raw) {
			try {
				return normalizeOptionsState(JSON.parse(raw));
			} catch {
				return normalizeOptionsState(null);
			}
		}

		return normalizeOptionsState(null);
	}

	function writeOptionsState(state) {
		safeSetLocalStorage(OPTS_KEY, JSON.stringify(state));
	}

	function readOptionsFromUi() {
		return {
			summaryCtxTemplate: String(ctxTplSummariesEl && ctxTplSummariesEl.value != null ? ctxTplSummariesEl.value : ""),
			epochCtxTemplate: String(ctxTplEpochsEl && ctxTplEpochsEl.value != null ? ctxTplEpochsEl.value : ""),
			summaryOutputLanguage: String(summaryOutputLanguageEl && summaryOutputLanguageEl.value != null ? summaryOutputLanguageEl.value : "en"),
			summaryExpectedInputLanguages: readMultiSelectValues(summaryExpectedInputLanguagesEl),
			summaryExpectedContextLanguages: readMultiSelectValues(summaryExpectedContextLanguagesEl),
			summaryType: String(summaryTypeEl && summaryTypeEl.value != null ? summaryTypeEl.value : "headline"),
			summaryLength: String(summaryLengthEl && summaryLengthEl.value != null ? summaryLengthEl.value : "long"),
			epochOutputLanguage: String(epochOutputLanguageEl && epochOutputLanguageEl.value != null ? epochOutputLanguageEl.value : "en"),
			epochExpectedInputLanguages: readMultiSelectValues(epochExpectedInputLanguagesEl),
			epochExpectedContextLanguages: readMultiSelectValues(epochExpectedContextLanguagesEl),
			epochType: String(epochTypeEl && epochTypeEl.value != null ? epochTypeEl.value : "headline"),
			epochLength: String(epochLengthEl && epochLengthEl.value != null ? epochLengthEl.value : "long")
		};
	}

	function applyOptionsStateToUi(state) {
		optionsState = normalizeOptionsState(state);
		if (ctxTplSummariesEl) ctxTplSummariesEl.value = optionsState.summaryCtxTemplate;
		if (ctxTplEpochsEl) ctxTplEpochsEl.value = optionsState.epochCtxTemplate;
		if (summaryTypeEl) summaryTypeEl.value = normalizeSummarizerType(optionsState.summaryType);
		if (summaryLengthEl) summaryLengthEl.value = normalizeSummarizerLength(optionsState.summaryLength);
		if (summaryOutputLanguageEl) summaryOutputLanguageEl.value = normalizeSupportedLanguage(optionsState.summaryOutputLanguage);
		setMultiSelectValues(summaryExpectedInputLanguagesEl, normalizeSupportedLanguageList(optionsState.summaryExpectedInputLanguages, ["en", "ja", "es"]));
		setMultiSelectValues(summaryExpectedContextLanguagesEl, normalizeSupportedLanguageList(optionsState.summaryExpectedContextLanguages, ["en"]));
		if (epochTypeEl) epochTypeEl.value = normalizeSummarizerType(optionsState.epochType);
		if (epochLengthEl) epochLengthEl.value = normalizeSummarizerLength(optionsState.epochLength);
		if (epochOutputLanguageEl) epochOutputLanguageEl.value = normalizeSupportedLanguage(optionsState.epochOutputLanguage);
		setMultiSelectValues(epochExpectedInputLanguagesEl, normalizeSupportedLanguageList(optionsState.epochExpectedInputLanguages, ["en", "ja", "es"]));
		setMultiSelectValues(epochExpectedContextLanguagesEl, normalizeSupportedLanguageList(optionsState.epochExpectedContextLanguages, ["en"]));
	}

	function pickTemplatesForJob(job) {
		if (!optionsState) optionsState = loadOptionsState();
		const isEpoch = job && job.kind === "epoch";
		const perCallTemplate = isEpoch
			? optionsState.epochCtxTemplate
			: optionsState.summaryCtxTemplate;
		return { perCallTemplate };
	}

	function safeStringify(obj, maxLen) {
		try {
			const s = JSON.stringify(obj, null, 2);
			if (typeof maxLen === "number" && s.length > maxLen) return s.slice(0, maxLen) + "\n…(truncated)";
			return s;
		} catch {
			return "";
		}
	}

	function formatJobErrorMessage(params) {
		const msg = String(params && params.msg ? params.msg : "");
		const job = params && params.job ? params.job : null;
		const opts = params && params.opts ? params.opts : null;
		const langs = params && params.langs ? params.langs : null;
		const context = params && typeof params.context === "string" ? params.context : "";
		const ctxPreview = context ? context.slice(0, 1200) + (context.length > 1200 ? "…" : "") : "";
		const payload = {
			error: msg,
			job: job ? {
				id: job.id,
				filePath: job.filePath,
				kind: job.kind,
				date: job.date,
				source: job.source,
				groupId: job.groupId,
				chunkIndex: job.chunkIndex,
				chunkCount: job.chunkCount,
				inputChars: (job.input && String(job.input).length) || 0
			} : null,
			options: opts,
			languages: langs,
			contextPreview: ctxPreview
		};
		return safeStringify(payload, 9000) || msg;
	}

	async function fetchSavedOptionsFromObsidian() {
		try {
			const r = await get("options");
			return (r && typeof r === "object") ? r : null;
		} catch {
			return null;
		}
	}

	async function postSavedOptionsToObsidian(o) {
		try {
			await post("options", o);
		} catch {
		}
	}

	function wireOptionsPersistence() {
		const save = () => {
			if (!optionsState) optionsState = loadOptionsState();
			const next = readOptionsFromUi();
			optionsState = normalizeOptionsState(next);
			writeOptionsState(optionsState);
			if (optionsSaveTimer) {
				try { window.clearTimeout(optionsSaveTimer); } catch {}
				optionsSaveTimer = 0;
			}
			optionsSaveTimer = window.setTimeout(() => {
				optionsSaveTimer = 0;
				void postSavedOptionsToObsidian(optionsState);
			}, 450);
		};
		const els = [
			ctxTplSummariesEl,
			ctxTplEpochsEl,
			summaryTypeEl,
			summaryLengthEl,
			summaryOutputLanguageEl,
			summaryExpectedInputLanguagesEl,
			summaryExpectedContextLanguagesEl,
			epochTypeEl,
			epochLengthEl,
			epochOutputLanguageEl,
			epochExpectedInputLanguagesEl,
			epochExpectedContextLanguagesEl
		].filter(Boolean);
		for (const el of els) {
			try { el.addEventListener("change", save); } catch {}
			try { el.addEventListener("input", save); } catch {}
		}
	}

	if (resetDefaultsBtn) {
		resetDefaultsBtn.addEventListener("click", () => {
			if (!optionsState) optionsState = loadOptionsState();
			const d = makeDefaultOptionsState();
			try {
				// Keep the bridge page empty-by-default on first load, but allow the
				// Reset button to restore the built-in defaults.
				if (typeof BUILTIN_DEFAULTS === "object" && BUILTIN_DEFAULTS) {
					if (typeof BUILTIN_DEFAULTS.summaryCtxTemplate === "string") d.summaryCtxTemplate = BUILTIN_DEFAULTS.summaryCtxTemplate;
					if (typeof BUILTIN_DEFAULTS.epochCtxTemplate === "string") d.epochCtxTemplate = BUILTIN_DEFAULTS.epochCtxTemplate;
				}
			} catch {
				// ignore
			}
			optionsState = d;
			applyOptionsStateToUi(d);
			writeOptionsState(d);
			void postSavedOptionsToObsidian(d);
		});
	}

		async function buildHttpError(res, path) {
			let details = "";
			try {
				const ct = String(res.headers && res.headers.get ? (res.headers.get("content-type") || "") : "");
				if (ct.includes("application/json")) {
					const j = await res.json().catch(() => null);
					if (j && typeof j === "object") details = " " + JSON.stringify(j);
				} else {
					const t = await res.text().catch(() => "");
					if (t) details = " " + t;
				}
			} catch {
			}
			return new Error("Bridge request failed: HTTP " + res.status + " (" + String(path) + ")" + details);
		}

		function makeAbortController() {
			try {
				if (typeof AbortController !== "undefined") return new AbortController();
			} catch {}
			return null;
		}

		// Global abort used to stop all in-flight HTTP polls on tab close.
		let PAGE_ABORT = makeAbortController();
		function abortAllBridgeRequests() {
			try { if (PAGE_ABORT) PAGE_ABORT.abort(); } catch {}
			PAGE_ABORT = makeAbortController();
		}

		function linkAbort(from, to) {
			try {
				if (!from || !to) return;
				if (!from.signal || !to.abort) return;
				from.signal.addEventListener("abort", () => {
					try { to.abort(); } catch {}
				}, { once: true });
			} catch {}
		}

		async function fetchWithTimeout(url, init, timeoutMs) {
			const ms = (typeof timeoutMs === "number" && Number.isFinite(timeoutMs)) ? Math.max(1000, timeoutMs) : 15000;
			const ctrl = makeAbortController();
			// If the page is closing, abort immediately.
			try {
				if (PAGE_ABORT && PAGE_ABORT.signal && PAGE_ABORT.signal.aborted) {
					throw new Error("Bridge request aborted (page closing)");
				}
			} catch {}
			// Abort this request if the page is closing.
			try { linkAbort(PAGE_ABORT, ctrl); } catch {}
			const timer = setTimeout(() => {
				try { if (ctrl) ctrl.abort(); } catch {}
			}, ms);
			try {
				const merged = Object.assign({}, init || {});
				if (ctrl) merged.signal = ctrl.signal;
				return await fetch(url, merged);
			} catch (e) {
				const msg = String(e && e.message ? e.message : e);
				if (/aborted|abort|timeout/i.test(msg)) {
					throw new Error("Bridge request timed out. Retrying...");
				}
				throw e;
			} finally {
				clearTimeout(timer);
			}
		}

		async function post(path, body) {
			const res = await fetchWithTimeout(API(path), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {})
			}, 15000);
		if (res.status === 403) throw new Error("Bridge token invalid. Re-open the bridge from Obsidian.");
		if (!res.ok) throw await buildHttpError(res, path);
		return await res.json().catch(() => ({}));
    }

    async function get(path) {
			const res = await fetchWithTimeout(API(path), null, 15000);
		if (res.status === 403) throw new Error("Bridge token invalid. Re-open the bridge from Obsidian.");
		if (!res.ok) throw await buildHttpError(res, path);
		return await res.json().catch(() => ({}));
    }

	function syncErrVisibility() {
		try {
			if (!errEl) return;
			const t = String(errEl.textContent || "").trim();
			errEl.style.display = t ? "" : "none";
		} catch {
			// ignore
		}
	}
	function setErrText(text) {
		if (!errEl) return;
		try { errEl.textContent = String(text || ""); } catch {}
		syncErrVisibility();
	}
	function setText(el, text) {
		el.textContent = text;
		try { if (el === errEl) syncErrVisibility(); } catch {}
	}

	function rangeMaxPow10(value) {
		const v = Math.max(1, Number(value) || 0);
		const p = Math.ceil(Math.log10(v));
		return Math.pow(10, Math.max(0, p));
	}

	function drawChart() {
		if (!chartCtx || !chart) return;
		const rect = chart.getBoundingClientRect ? chart.getBoundingClientRect() : null;
		const cssW = Math.max(1, rect ? rect.width : chart.width);
		const cssH = Math.max(1, rect ? rect.height : chart.height);
		const dpr = Math.max(1, Math.floor((window.devicePixelRatio || 1) * 100) / 100);
		const pxW = Math.max(1, Math.round(cssW * dpr));
		const pxH = Math.max(1, Math.round(cssH * dpr));
		if (chart.width !== pxW) chart.width = pxW;
		if (chart.height !== pxH) chart.height = pxH;

		chartCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
		const w = cssW;
		const h = cssH;
		chartCtx.clearRect(0, 0, w, h);
		chartCtx.fillStyle = "#1f1f1f";
		chartCtx.fillRect(0, 0, w, h);
		if (!speedSeries.length && !remainingPctSeries.length) return;

		const isFiniteNumber = (v) => (typeof v === "number" && Number.isFinite(v));
		let maxValue = 1;
		try {
			for (const v of speedSeries) {
				if (!isFiniteNumber(v)) continue;
				if (v > maxValue) maxValue = v;
			}
		} catch {}
		const maxY = rangeMaxPow10(maxValue);
		const padL = 40;
		const padR = 6;
		const padT = 4;
		const padB = 8;
		const gw = Math.max(1, w - padL - padR);
		const gh = Math.max(1, h - padT - padB);

		if (remainingPctSeries.length) {
			const series = remainingPctSeries;
			const bottom = padT + gh;
			chartCtx.save();
			chartCtx.fillStyle = "rgba(178, 197, 208, 0.22)";
			chartCtx.beginPath();
			for (let i = 0; i < series.length; i++) {
				const pct = Math.max(0, Math.min(1, Number(series[i]) || 0));
				const x = padL + (i / Math.max(1, series.length - 1)) * gw;
				const y = padT + (1 - pct) * gh;
				if (i === 0) {
					chartCtx.moveTo(x, bottom);
					chartCtx.lineTo(x, y);
				} else {
					chartCtx.lineTo(x, y);
				}
			}
			chartCtx.lineTo(padL + gw, bottom);
			chartCtx.closePath();
			chartCtx.fill();
			chartCtx.restore();
		}

		chartCtx.font = "12px ui-monospace, Menlo, Consolas";
		chartCtx.fillStyle = "#9aa0a6";
		chartCtx.strokeStyle = "#333";
		chartCtx.lineWidth = 1;
		const maxPow = Math.round(Math.log10(maxY));
		for (let p = 0; p <= maxPow; p++) {
			const tick = Math.pow(10, p);
			const y = padT + (1 - tick / maxY) * gh;
			chartCtx.globalAlpha = 0.55;
			chartCtx.beginPath();
			chartCtx.moveTo(padL, y);
			chartCtx.lineTo(padL + gw, y);
			chartCtx.stroke();
			chartCtx.globalAlpha = 1;
			if (p === maxPow) {
				chartCtx.fillText(String(tick), 4, y + 4);
			}
		}

		chartCtx.strokeStyle = "#8c9ea9";
		chartCtx.lineWidth = 2;
		chartCtx.beginPath();
		let started = false;
		speedSeries.forEach((v, i) => {
			if (!isFiniteNumber(v)) {
				started = false;
				return;
			}
			const x = padL + (i / Math.max(1, speedSeries.length - 1)) * gw;
			const y = padT + (1 - (v / maxY)) * gh;
			if (!started) {
				chartCtx.moveTo(x, y);
				started = true;
			} else {
				chartCtx.lineTo(x, y);
			}
		});
		if (started) chartCtx.stroke();
	}

	function clamp01(value) {
		const v = Number(value);
		if (!Number.isFinite(v)) return 0;
		if (v <= 0) return 0;
		if (v >= 1) return 1;
		return v;
	}

	function normalizeProgressOrNull(raw) {
		const n = Number(raw);
		if (!Number.isFinite(n)) return null;
		// Some implementations may emit percentage [0..100]
		if (n > 1.01 && n <= 100) return clamp01(n / 100);
		// Ignore clearly invalid values instead of clamping them
		if (n < 0 || n > 1.01) return null;
		return clamp01(n);
	}

	const statusState = { mode: "unknown", progress: null };
	let lastDetectAt = 0;
	const BRIDGE_STARTUP_AT = Date.now();
	const BRIDGE_STARTUP_GRACE_MS = 3500;
	let bridgeDisconnected = false;
	let bridgeTriedWindowClose = false;
	let bridgeRetryAt = 0;
	let bridgeRetryDelayMs = 500;
	const BRIDGE_RETRY_MIN_MS = 500;
	const BRIDGE_RETRY_MAX_MS = 15000;

	function resetBridgeRetryState() {
		bridgeRetryAt = 0;
		bridgeRetryDelayMs = BRIDGE_RETRY_MIN_MS;
	}

	function noteBridgeRetryNeeded() {
		const now = Date.now();
		const delay = Math.max(BRIDGE_RETRY_MIN_MS, Math.min(BRIDGE_RETRY_MAX_MS, bridgeRetryDelayMs || BRIDGE_RETRY_MIN_MS));
		bridgeRetryAt = now + delay;
		bridgeRetryDelayMs = Math.min(BRIDGE_RETRY_MAX_MS, Math.round(delay * 1.6 + 50));
	}

	function shouldAttemptBridgeRetryNow() {
		const now = Date.now();
		const at = Number(bridgeRetryAt || 0);
		return !at || now >= at;
	}

	function shouldCloseOnDisconnect() {
		try {
			const u = new URL(window.location.href);
			return u.searchParams.get("closeOnDisconnect") === "1";
		} catch {
			return false;
		}
	}

	function isFatalBridgeDisconnectMessage(message) {
		const msg = String(message || "");
		if (!msg) return false;
		if (/token invalid/i.test(msg)) return true;
		if (/\bforbidden\b/i.test(msg)) return true;
		return false;
	}

	function handleBridgeReconnected() {
		if (!bridgeDisconnected) return;
		bridgeDisconnected = false;
		resetBridgeRetryState();
		try { if (statusEl) statusEl.textContent = "Reconnected"; } catch {}
		try { if (curEl) curEl.textContent = "idle"; } catch {}
		try { if (clearQueueBtn) clearQueueBtn.disabled = false; } catch {}
		try {
			const t = String(errEl && errEl.textContent ? errEl.textContent : "");
			// Only clear errors that were likely caused by transient bridge disconnects.
			if (t && /(failed to fetch|networkerror|bridge request timed out|timed out\. retrying|load failed|fetch\b)/i.test(t)) {
				setErrText("");
			}
		} catch {}
		try { if (typeof renderStatusText === "function") renderStatusText(); } catch {}
	}

	function handleBridgeDisconnected(message) {
		const msg = message ? String(message) : "";
		const shouldClose = shouldCloseOnDisconnect();
		const fatal = shouldClose || isFatalBridgeDisconnectMessage(msg);

		if (!bridgeDisconnected) {
			bridgeDisconnected = true;
			try { if (statusEl) statusEl.textContent = "Disconnected"; } catch {}
			try { if (curEl) curEl.textContent = "disconnected"; } catch {}
			try { if (clearQueueBtn) clearQueueBtn.disabled = true; } catch {}
		}
		try {
			if (msg) setErrText(msg);
		} catch {}

		// Stop processing work; the tab should auto-resume when the bridge comes back.
		try { running = false; } catch {}

		if (fatal) {
			// Ensure loops/polls/timers are stopped.
			try { if (typeof teardownBridgePage === "function") teardownBridgePage("disconnected"); } catch {}
			// Best-effort: browsers often block closing tabs not opened by script.
			try {
				if (shouldClose && !bridgeTriedWindowClose) {
					bridgeTriedWindowClose = true;
					window.close();
				}
			} catch {}
			return;
		}

		// Non-fatal disconnect (e.g., Obsidian restarted): keep the tab alive and retry.
		noteBridgeRetryNeeded();
	}
`;
