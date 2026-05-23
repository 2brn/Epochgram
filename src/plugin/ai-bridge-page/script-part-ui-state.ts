export const AI_BRIDGE_SCRIPT_PART1_CHUNK_A = String.raw`
	function safeGetLocalStorage(key) {
		try { return window.localStorage.getItem(key); } catch { return null; }
	}
	function safeSetLocalStorage(key, value) {
		try { window.localStorage.setItem(key, value); } catch {}
	}

	function makeDefaultOptionsState() {
		return {
			settingsYaml: String(BUILTIN_DEFAULTS && BUILTIN_DEFAULTS.settingsYaml ? BUILTIN_DEFAULTS.settingsYaml : ""),
			settingsYamlFormatted: "",
			resolved: null
		};
	}

	function escapeHtml(raw) {
		return String(raw || "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;");
	}

	function renderYamlHighlight(yamlText) {
		if (!settingsYamlHighlightEl) return;
		const src = String(yamlText || "");
		const lines = src.split("\n");
		const out = [];
		for (const ln of lines) {
			let line = escapeHtml(ln);
			line = line.replace(/(^|\s)(#.*$)/, "$1<span class=\"yamlComment\">$2</span>");
			line = line.replace(/^(\s*-\s*)([A-Za-z_][\w-]*)(\s*:)/, "$1<span class=\"yamlKey\">$2</span>$3");
			line = line.replace(/^(\s*)([A-Za-z_][\w-]*)(\s*:)/, "$1<span class=\"yamlKey\">$2</span>$3");
			line = line.replace(/(\|\s*)$/, "<span class=\"yamlPipe\">$1</span>");
			line = line.replace(/(:\s*)([^#\n][^\n]*)$/, (m, a, b) => {
				const v = String(b || "");
				if (!v.trim()) return m;
				return a + "<span class=\"yamlString\">" + v + "</span>";
			});
			out.push(line);
		}
		settingsYamlHighlightEl.innerHTML = out.join("\n") + "\n";
	}

	function setYamlValidationState(ok, errors, warnings) {
		const hasErrors = !ok && Array.isArray(errors) && errors.length > 0;
		if (settingsPanelEl && settingsPanelEl.classList) {
			if (hasErrors) settingsPanelEl.classList.add("invalid");
			else settingsPanelEl.classList.remove("invalid");
		}
		if (settingsErrorsEl) {
			let message = "";
			if (Array.isArray(errors) && errors.length > 0) {
				message = String(errors[0] || "").split(/\r?\n/)[0] || "";
			} else if (Array.isArray(warnings) && warnings.length > 0) {
				message = "warning: " + (String(warnings[0] || "").split(/\r?\n/)[0] || "");
			}
			settingsErrorsEl.textContent = message;
		}
	}

	async function validateSettingsYaml(yamlText) {
		try {
			return await post("options/validate", { settingsYaml: String(yamlText || "") });
		} catch (e) {
			return {
				ok: false,
				errors: [String(e && e.message ? e.message : e)],
				warnings: [],
				formattedUserYaml: String(yamlText || "")
			};
		}
	}

	function normalizeOptionsState(raw) {
		const state = makeDefaultOptionsState();
		if (!raw || typeof raw !== "object") return state;
		if (typeof raw.settingsYaml === "string") state.settingsYaml = raw.settingsYaml;
		if (typeof raw.settingsYamlFormatted === "string") state.settingsYamlFormatted = raw.settingsYamlFormatted;
		if (raw.resolved && typeof raw.resolved === "object") state.resolved = raw.resolved;
		return state;
	}

	function mergeOptionsState(localRaw, savedRaw) {
		const local = normalizeOptionsState(localRaw);
		const saved = normalizeOptionsState(savedRaw);
		const d = makeDefaultOptionsState();
		const settingsYaml = String(
			(saved && typeof saved.settingsYaml === "string" && saved.settingsYaml.trim())
				? saved.settingsYaml
				: (local && typeof local.settingsYaml === "string" && local.settingsYaml.trim())
					? local.settingsYaml
					: d.settingsYaml
		);
		return normalizeOptionsState({
			settingsYaml,
			settingsYamlFormatted: typeof saved.settingsYamlFormatted === "string" ? saved.settingsYamlFormatted : "",
			resolved: saved.resolved || local.resolved || null
		});
	}

	function loadOptionsState() {
		const raw = safeGetLocalStorage(OPTS_KEY);
		if (raw) {
			try {
				return normalizeOptionsState(JSON.parse(raw));
			} catch {
				return makeDefaultOptionsState();
			}
		}
		return makeDefaultOptionsState();
	}

	function writeOptionsState(state) {
		safeSetLocalStorage(OPTS_KEY, JSON.stringify(state || makeDefaultOptionsState()));
	}

	function readOptionsFromUi() {
		return {
			settingsYaml: String(settingsYamlEl && settingsYamlEl.value != null ? settingsYamlEl.value : "")
		};
	}

	function applyOptionsStateToUi(state) {
		optionsState = normalizeOptionsState(state);
		if (settingsYamlEl) settingsYamlEl.value = String(optionsState.settingsYaml || "");
		renderYamlHighlight(String(optionsState.settingsYaml || ""));
	}

	function syncYamlOverlayScroll() {
		try {
			if (!settingsYamlEl || !settingsYamlHighlightEl) return;
			settingsYamlHighlightEl.scrollTop = settingsYamlEl.scrollTop;
			settingsYamlHighlightEl.scrollLeft = settingsYamlEl.scrollLeft;
		} catch {
			// ignore
		}
	}

	async function validateAndPersistYaml(options) {
		const opts = options || {};
		const shouldPersist = opts.persist !== false;
		const shouldFormat = opts.format === true;
		const yamlText = String(settingsYamlEl && settingsYamlEl.value != null ? settingsYamlEl.value : "");
		const result = await validateSettingsYaml(yamlText);
		const ok = !!(result && result.ok === true);
		setYamlValidationState(ok, result && result.errors ? result.errors : [], result && result.warnings ? result.warnings : []);
		if (!ok) return null;
		const nextYaml = yamlText;
		renderYamlHighlight(nextYaml);
		syncYamlOverlayScroll();
		const nextState = normalizeOptionsState({
			settingsYaml: nextYaml,
			settingsYamlFormatted: typeof result.formattedUserYaml === "string" ? result.formattedUserYaml : "",
			resolved: result && result.resolved ? result.resolved : null
		});
		const prevYaml = optionsState && typeof optionsState.settingsYaml === "string" ? String(optionsState.settingsYaml) : "";
		optionsState = nextState;
		if (prevYaml !== nextState.settingsYaml) {
			try { summarizersByKey.clear(); } catch {}
		}
		if (shouldPersist) {
			writeOptionsState(nextState);
			void postSavedOptionsToObsidian({ settingsYaml: nextState.settingsYaml });
		}
		return result;
	}

	function normalizeEpochBucket(raw) {
		return String(raw || "").trim().toLowerCase();
	}

	function normalizeSummarizerType(raw) {
		const v = typeof raw === "string" ? raw : "";
		if (v === "tldr" || v === "teaser" || v === "key-points" || v === "headline") return v;
		return "headline";
	}

	function normalizeSummarizerLength(raw) {
		const v = typeof raw === "string" ? raw : "";
		if (v === "short" || v === "medium" || v === "long") return v;
		return "short";
	}

	function normalizeSummarizerPreference(raw) {
		const v = typeof raw === "string" ? raw : "";
		if (v === "auto" || v === "speed" || v === "capability") return v;
		return "auto";
	}

	function normalizeOptionalPositiveInteger(raw) {
		if (typeof raw === "number" && Number.isFinite(raw)) {
			const n = Math.floor(raw);
			return n > 0 ? n : null;
		}
		if (typeof raw === "string") {
			const trimmed = String(raw).trim();
			if (!trimmed) return null;
			if (!/^\d+$/.test(trimmed)) return null;
			const n = Number(trimmed);
			return Number.isSafeInteger(n) && n > 0 ? n : null;
		}
		return null;
	}

	function periodCoversBucket(period, bucket) {
		const order = ["day", "2days", "4days", "week", "2weeks", "month", "3months", "6months", "year"];
		const normalizedBucket = normalizeEpochBucket(bucket);
		const idx = order.indexOf(normalizedBucket);
		if (idx < 0) return false;
		const p = String(period || "").trim().toLowerCase();
		if (!p) return false;
		if (!p.includes("-")) return normalizeEpochBucket(p) === normalizedBucket;
		const pair = p.split("-");
		if (pair.length !== 2) return false;
		const a = order.indexOf(normalizeEpochBucket(pair[0]));
		const b = order.indexOf(normalizeEpochBucket(pair[1]));
		if (a < 0 || b < 0 || a > b) return false;
		return idx >= a && idx <= b;
	}

	function mergeSettingsBlock(base, override) {
		const out = Object.assign({}, base || {});
		if (!override || typeof override !== "object") return out;
		for (const key of ["type", "format", "length", "preference", "expectedInputLanguages", "outputLanguage", "expectedContextLanguages", "context", "maxOutputWords"]) {
			if (override[key] != null) out[key] = override[key];
		}
		return out;
	}

	function buildBridgeSettingsForJob(job) {
		if (!optionsState) optionsState = loadOptionsState();
		const resolved = optionsState && optionsState.resolved && typeof optionsState.resolved === "object" ? optionsState.resolved : null;
		const root = resolved || {
			type: "headline",
			format: "plain-text",
			length: "short",
			preference: "auto",
			expectedInputLanguages: ["en", "ja", "es"],
			outputLanguage: "en",
			expectedContextLanguages: ["en"],
			sharedContext: "",
			epochs: []
		};
		let merged = mergeSettingsBlock(root, null);
		let contextTemplate = "";
		const isEpoch = !!(job && job.kind === "epoch");
		const isReduce = !!(job && job.reduce === true);
		const chunkCount = Number(job && job.chunkCount != null ? job.chunkCount : 0);
		const isIntermediateReduce = isReduce && !!(job && job.groupId) && Number.isFinite(chunkCount) && chunkCount > 1;

		if (isIntermediateReduce && root.reduce) {
			merged = mergeSettingsBlock(merged, root.reduce);
			contextTemplate = String(root.reduce.context || "");
			const d = Number(job && job.reduceDepth != null ? job.reduceDepth : 0);
			contextTemplate = contextTemplate.replace(/\{\{reduceDepth\}\}/g, String(Number.isFinite(d) ? d : 0));
		} else if (isEpoch) {
			const bucket = normalizeEpochBucket(job && job.epochBucket);
			const rules = Array.isArray(root.epochs) ? root.epochs : [];
			for (const r of rules) {
				if (!r || typeof r !== "object") continue;
				if (!periodCoversBucket(r.period, bucket)) continue;
				merged = mergeSettingsBlock(merged, r);
				contextTemplate = typeof r.context === "string" ? r.context : contextTemplate;
				break;
			}
		} else if (root.records) {
			merged = mergeSettingsBlock(merged, root.records);
			contextTemplate = String(root.records.context || "");
		}

		const sharedContext = String(root.sharedContext || "").trim();
		const jobSpecificContext = String(contextTemplate || "").trim();
		const maxOutputWords = normalizeOptionalPositiveInteger(merged.maxOutputWords);

		return {
			type: normalizeSummarizerType(merged.type),
			format: (String(merged.format || "plain-text") === "markdown" ? "markdown" : "plain-text"),
			length: normalizeSummarizerLength(merged.length),
			preference: normalizeSummarizerPreference(merged.preference),
			outputLanguage: normalizeSupportedLanguage(merged.outputLanguage),
			expectedInputLanguages: normalizeSupportedLanguageList(merged.expectedInputLanguages, ["en", "ja", "es"]),
			expectedContextLanguages: normalizeSupportedLanguageList(merged.expectedContextLanguages, ["en"]),
			maxOutputWords,
			sharedContext,
			jobSpecificContext
		};
	}

	function pickTemplatesForJob(job) {
		const s = buildBridgeSettingsForJob(job);
		return { perCallTemplate: s.jobSpecificContext || "" };
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
			const payload = {
				settingsYaml: String(o && typeof o.settingsYaml === "string" ? o.settingsYaml : "")
			};
			await post("options", payload);
		} catch {
		}
	}

	function wireOptionsPersistence() {
		if (!settingsYamlEl) return;
		const queueValidate = () => {
			renderYamlHighlight(String(settingsYamlEl.value || ""));
			syncYamlOverlayScroll();
			if (optionsValidationTimer) {
				try { window.clearTimeout(optionsValidationTimer); } catch {}
				optionsValidationTimer = 0;
			}
			optionsValidationTimer = window.setTimeout(() => {
				optionsValidationTimer = 0;
				void validateAndPersistYaml({ persist: true, format: false });
			}, 260);
		};
		try {
			settingsYamlEl.addEventListener("keydown", (e) => {
				if (e.key !== "Enter") return;
				const el = settingsYamlEl;
				const start = el.selectionStart ?? 0;
				const end = el.selectionEnd ?? start;
				const val = el.value;
				const wasAtEnd = start === val.length && end === val.length;
				const lineStart = val.lastIndexOf("\n", start - 1) + 1;
				const lineEndRaw = val.indexOf("\n", start);
				const lineEnd = lineEndRaw >= 0 ? lineEndRaw : val.length;
				const lineText = val.slice(lineStart, lineEnd);
				const beforeCaret = val.slice(lineStart, start);
				const indentFromLine = lineText.match(/^(\s*)/)?.[1] ?? "";
				const indent = /^\s*$/.test(beforeCaret) ? beforeCaret : indentFromLine;
				const trimmed = beforeCaret.trimEnd();
				const extraIndent = /(?:^|\s)-\s*$|:\s*$|[|>][-+]?\s*$/.test(trimmed) ? "  " : "";
				e.preventDefault();
				const insert = "\n" + indent + extraIndent;
				el.value = val.slice(0, start) + insert + val.slice(end);
				el.selectionStart = el.selectionEnd = start + insert.length;
				if (wasAtEnd) {
					try {
						el.scrollTop = el.scrollHeight;
					} catch {}
				}
				queueValidate();
			});
		} catch {}
		try { settingsYamlEl.addEventListener("input", queueValidate); } catch {}
		try { settingsYamlEl.addEventListener("scroll", syncYamlOverlayScroll); } catch {}
		try {
			settingsYamlEl.addEventListener("blur", () => {
				void validateAndPersistYaml({ persist: true, format: true });
			});
		} catch {}
	}

	if (resetDefaultsBtn) {
		resetDefaultsBtn.addEventListener("click", () => {
			const d = makeDefaultOptionsState();
			applyOptionsStateToUi(d);
			void validateAndPersistYaml({ persist: true, format: true });
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

	function rangeMaxPow2(value) {
		const v = Math.max(1, Number(value) || 0);
		if (v < 10) return Math.max(1, Math.round(v));
		const digits = Math.floor(Math.log(v) / Math.log(10)) + 1;
		const step = Math.pow(10, Math.max(1, digits - 1));
		const rounded = Math.round(v / step) * step;
		if (rounded >= v) return rounded;
		return rounded + step;
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
		const maxY = rangeMaxPow2(maxValue);
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
		chartCtx.fillText(String(maxY), 4, padT + 4);

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
