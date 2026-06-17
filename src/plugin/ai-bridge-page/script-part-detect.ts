export const AI_BRIDGE_SCRIPT_PART2 = String.raw`

	let detectInFlight = null;

	async function readSummarizerAvailabilitySafe() {
		try {
			if (!("Summarizer" in globalThis)) return { ok: false, availability: null };
			const langs = readSelectedBridgeLanguages("summary");
			const opts = {
				// Keep this conservative to avoid flakiness across Chrome versions.
				expectedInputLanguages: [langs.expectedInputLanguages[0] || "en"],
				expectedContextLanguages: [langs.expectedContextLanguages[0] || "en"],
				outputLanguage: langs.outputLanguage || "en",
			};
			const availability = await Summarizer.availability(opts);
			return { ok: true, availability };
		} catch (e) {
			return { ok: false, availability: null };
		}
	}

	async function detectInner() {
		if (!("Summarizer" in globalThis)) {
			setApiNotDetectedStatus();
			return;
		}
		const first = await readSummarizerAvailabilitySafe();
		if (!first.ok) {
			setStatusMode("unknown");
			return;
		}
		const availability = first.availability;
		if (availability === "unavailable") {
			setUnavailableStatus();
			return;
		}
		if (availability === "downloadable" || availability === "downloading") {
			if (availability === "downloadable") {
				setDownloadableStatus();
				return;
			}
			setStatusMode("downloading");
			return;
		}
		if (availability === "available") {
			setModelReadyStatus();
			return;
		}
		setStatusMode("unknown");
	}

	async function detect() {
		if (detectInFlight) return await detectInFlight;
		detectInFlight = (async () => {
			try {
				return await detectInner();
			} finally {
				detectInFlight = null;
			}
		})();
		return await detectInFlight;
	}

	if (downloadBtn) {
		downloadBtn.addEventListener("click", async () => {
			try {
				if (!("Summarizer" in globalThis)) {
					setApiNotDetectedStatus();
					return;
				}
				const langs = readSelectedBridgeLanguages("summary");
				// Chrome warns if outputLanguage is omitted; include explicit languages.
				await Summarizer.create({
					outputLanguage: langs.outputLanguage,
					expectedInputLanguages: [langs.expectedInputLanguages[0] || "en"],
					expectedContextLanguages: [langs.expectedContextLanguages[0] || "en"],
					monitor(m) {
						try {
							m.addEventListener("downloadprogress", (e) => {
								const agg = aggregateDownloadProgressEvent(e || {});
								if (typeof agg.progress !== "number") return;
								setModelDownloadingStatus(agg.progress);
							});
						} catch { void 0; }
					}
				});
				setModelReadyStatus();
			} catch (e) {
				const msg = String(e && e.message ? e.message : e);
				try { setErrText(msg); } catch { try { errEl.textContent = msg; } catch { void 0; } }
			}
		});
	}

	async function ensureLanguageDetector() {
		return null;
	}

	function pickDetectedLanguage(result) {
		if (!result) return null;
		if (typeof result === "string") return result;
		if (Array.isArray(result) && result.length > 0) {
			const top = result[0];
			const code = top && (top.detectedLanguage || top.language || top.lang);
			return typeof code === "string" ? code : null;
		}
		return null;
	}

	function normalizeSupportedLanguage(code) {
		const raw = typeof code === "string" ? code : "";
		if (!raw) return "en";
		const base = raw.toLowerCase().split(/[-_]/)[0] || "en";
		if (base === "en" || base === "es" || base === "ja") return base;
		return "en";
	}

	function normalizeSupportedLanguageList(raw, fallbackArr) {
		const arr = Array.isArray(raw) ? raw : (typeof raw === "string" && raw ? [raw] : []);
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

	function readSelectedBridgeLanguages(kind) {
		try {
			const isEpoch = kind === "epoch";
			const outEl = isEpoch ? epochOutputLanguageEl : summaryOutputLanguageEl;
			const inEl = isEpoch ? epochExpectedInputLanguagesEl : summaryExpectedInputLanguagesEl;
			const ctxEl = isEpoch ? epochExpectedContextLanguagesEl : summaryExpectedContextLanguagesEl;
			const stateOutKey = isEpoch ? "epochOutputLanguage" : "summaryOutputLanguage";
			const stateInKey = isEpoch ? "epochExpectedInputLanguages" : "summaryExpectedInputLanguages";
			const stateCtxKey = isEpoch ? "epochExpectedContextLanguages" : "summaryExpectedContextLanguages";
			const outLang = normalizeSupportedLanguage(
				(optionsState && typeof optionsState[stateOutKey] === "string" && optionsState[stateOutKey])
					? optionsState[stateOutKey]
					: (outEl && typeof outEl.value === "string" ? outEl.value : "en")
			);
			const readMulti = (el) => {
				try {
					if (!el || !el.selectedOptions) return [];
					return Array.from(el.selectedOptions)
						.map(o => String(o && o.value != null ? o.value : ""))
						.filter(Boolean);
				} catch {
					return [];
				}
			};
			const inRaw = (optionsState && optionsState[stateInKey] != null)
				? optionsState[stateInKey]
				: readMulti(inEl);
			const ctxRaw = (optionsState && optionsState[stateCtxKey] != null)
				? optionsState[stateCtxKey]
				: readMulti(ctxEl);
			return {
				outputLanguage: outLang,
				expectedInputLanguages: normalizeSupportedLanguageList(inRaw, ["en", "ja", "es"]),
				expectedContextLanguages: normalizeSupportedLanguageList(ctxRaw, ["en"]),
			};
		} catch {
			return {
				outputLanguage: "en",
				expectedInputLanguages: ["en", "ja", "es"],
				expectedContextLanguages: ["en"],
			};
		}
	}

	function fileNameFromPath(p) {
		const raw = typeof p === "string" ? p : "";
		const name = raw.split(/[\\/]/).pop() || raw;
		return name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name;
	}

	function renderContextTemplate(template, job, opts) {
		const tpl = typeof template === "string" ? template : "";
		if (!tpl.trim()) return "";
		const fileName = fileNameFromPath(job && job.filePath ? job.filePath : "");
		const jobAny = job || {};
		const isEpoch = jobAny && jobAny.kind === "epoch";
		const related = String(job && typeof job.related === "string" ? job.related : "");
		const dict = isEpoch
			? {
				related,
			}
			: {
				filePath: String(job && job.filePath ? job.filePath : ""),
				fileName,
				related
			};
		return tpl
			.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in dict ? dict[k] : m));
	}

	async function detectOutputLanguage(job) {
		return "en";
	}

	async function createSummarizer(optionsIn) {
		if (!("Summarizer" in globalThis)) throw new Error("Summarizer API missing");

		lastProgress = null;
		resetDownloadProgressState({ soft: true });
		const options = {
			type: optionsIn && optionsIn.type ? optionsIn.type : "headline",
			length: optionsIn && optionsIn.length ? optionsIn.length : "long",
			format: optionsIn && optionsIn.format ? optionsIn.format : "plain-text",
			preference: optionsIn && optionsIn.preference ? optionsIn.preference : "auto",
			monitor(m) {
				try {
					resetDownloadProgressState({ soft: true });
					m.addEventListener("downloadprogress", (e) => {
						const agg = aggregateDownloadProgressEvent(e || {});
						const normalized = applyDownloadProgress(agg.progress, false, { reset: agg.reset });
						if (typeof normalized !== "number") return;
					});
				} catch { void 0; }
			}
		};

		const outLangRaw = optionsIn && typeof optionsIn.outputLanguage === "string" ? optionsIn.outputLanguage : null;
		const inLangsRaw = optionsIn && Array.isArray(optionsIn.expectedInputLanguages)
			? optionsIn.expectedInputLanguages
			: null;
		const ctxLangsRaw = optionsIn && Array.isArray(optionsIn.expectedContextLanguages)
			? optionsIn.expectedContextLanguages
			: null;
		const outLang = normalizeSupportedLanguage(outLangRaw || "en");
		const inLangs = normalizeSupportedLanguageList(inLangsRaw || [outLang], [outLang]);
		const ctxLangs = normalizeSupportedLanguageList(ctxLangsRaw || [outLang], [outLang]);
		options.expectedInputLanguages = inLangs;
		options.expectedContextLanguages = ctxLangs;
		options.outputLanguage = outLang;

		const sharedCtx = optionsIn && typeof optionsIn.sharedContext === "string" ? optionsIn.sharedContext : "";
		if (sharedCtx.trim()) options.sharedContext = sharedCtx;

		try {
			return await Summarizer.create(options);
		} catch (e) {
			try {
				const fallback = {
					type: "headline",
					length: "long",
					format: "plain-text",
					preference: options.preference,
					monitor: options.monitor
				};
				fallback.expectedInputLanguages = inLangs;
				fallback.expectedContextLanguages = ctxLangs;
				fallback.outputLanguage = outLang;
				if (sharedCtx.trim()) fallback.sharedContext = sharedCtx;
				return await Summarizer.create(fallback);
			} catch {
				throw e;
			}
		}
	}

	function makeSummarizerKey(o) {
		const outLang = (o && typeof o.outputLanguage === "string" && o.outputLanguage) ? normalizeSupportedLanguage(o.outputLanguage) : "auto";
		const inRaw = (o && Array.isArray(o.expectedInputLanguages)) ? o.expectedInputLanguages : [];
		const ctxRaw = (o && Array.isArray(o.expectedContextLanguages)) ? o.expectedContextLanguages : [];
		const inLangs = normalizeSupportedLanguageList(inRaw, [outLang]);
		const ctxLangs = normalizeSupportedLanguageList(ctxRaw, [outLang]);
		const t = String(o && o.type ? o.type : "headline");
		const l = String(o && o.length ? o.length : "long");
		const f = String(o && o.format ? o.format : "plain-text");
		const p = String(o && o.preference ? o.preference : "auto");
		const shared = String(o && typeof o.sharedContext === "string" ? o.sharedContext : "").trim();
		return [outLang, inLangs.join(","), ctxLangs.join(","), t, l, f, p, shared].join("|");
	}

	async function ensureSummarizer(o) {
		const key = makeSummarizerKey(o);
		if (summarizersByKey.has(key)) return summarizersByKey.get(key);
		try {
			const s = await createSummarizer(o);
			summarizersByKey.set(key, s);
			return s;
		} catch (e) {
			try {
				const s2 = await createSummarizer({ type: "headline", length: "long", format: "plain-text", preference: "auto", outputLanguage: "en", expectedInputLanguages: ["en"], expectedContextLanguages: ["en"] });
				summarizersByKey.set(makeSummarizerKey({ type: "headline", length: "long", format: "plain-text", preference: "auto", outputLanguage: "en", expectedInputLanguages: ["en"], expectedContextLanguages: ["en"] }), s2);
				return s2;
			} catch {
				throw e;
			}
		}
	}

	async function safeMeasureInputUsage(s, text) {
		try {
			if (!s || typeof s.measureInputUsage !== "function") return null;
			return await s.measureInputUsage(String(text || ""));
		} catch {
			return null;
		}
	}

	function isHeadingLine(line) {
		const s = String(line || "");
		return /^#{1,6}\s+\S/.test(s);
	}

	function splitByHeadingsAndParagraphs(text) {
		const raw = String(text || "").replace(/\r\n?/g, "\n");
		if (!raw.trim()) return [];
		const lines = raw.split("\n");
		const segments = [];
		let cur = "";
		let pendingHeading = "";
		const flush = () => {
			const t = String(cur || "").trim();
			cur = "";
			if (!t) return;
			if (pendingHeading) {
				segments.push((pendingHeading + "\n" + t).trim());
				pendingHeading = "";
				return;
			}
			segments.push(t);
		};
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i] ?? "";
			if (isHeadingLine(line)) {
				flush();
				pendingHeading = String(line).trim();
				continue;
			}
			if (!String(line).trim()) {
				flush();
				continue;
			}
			cur += (cur ? "\n" : "") + line;
		}
		flush();
		if (pendingHeading) segments.push(String(pendingHeading).trim());
		return segments;
	}

	function tailOverlap(text, overlapChars) {
		const t = String(text || "");
		const n = (typeof overlapChars === "number" && Number.isFinite(overlapChars)) ? Math.max(0, Math.floor(overlapChars)) : 0;
		if (!t || n <= 0) return "";
		if (t.length <= n) return t;
		return t.slice(t.length - n);
	}

	async function chunkToTargetUsage(s, inputText, quota, targetUsage, overlapChars) {
		const text = String(inputText || "").trim();
		if (!text) return [""];
		const segments = splitByHeadingsAndParagraphs(text);
		if (segments.length === 0) return [text];

		const out = [];
		let cur = "";
		let prevFinal = "";

		const pushCur = () => {
			const t = String(cur || "").trim();
			cur = "";
			if (!t) return;
			out.push(t);
			prevFinal = t;
		};

		for (const seg of segments) {
			const trimmed = String(seg || "").trim();
			if (!trimmed) continue;
			const overlap = cur ? "" : tailOverlap(prevFinal, overlapChars);
			const candidate = (overlap ? (overlap + "\n\n" + trimmed) : (cur ? (cur + "\n\n" + trimmed) : trimmed));
			const usage = await safeMeasureInputUsage(s, candidate);
			if (usage != null && Number.isFinite(usage) && usage <= quota && usage <= targetUsage) {
				cur = candidate;
				continue;
			}
			if (cur) {
				pushCur();
				const overlap2 = tailOverlap(prevFinal, overlapChars);
				const candidate2 = overlap2 ? (overlap2 + "\n\n" + trimmed) : trimmed;
				cur = candidate2;
				continue;
			}
			// Single segment too large for target/quota: split by halves until it fits.
			let remaining = trimmed;
			while (remaining && remaining.length > 0) {
				const usage0 = await safeMeasureInputUsage(s, remaining);
				if (usage0 == null || !Number.isFinite(usage0) || usage0 <= quota) {
					cur = remaining;
					break;
				}
				const mid = Math.max(1, Math.floor(remaining.length / 2));
				const left = remaining.slice(0, mid).trim();
				const right = remaining.slice(mid).trim();
				if (left) out.push(left);
				remaining = right;
			}
		}
		pushCur();
		return out.length ? out : [text];
	}

	function normalizeQuota(q) {
		if (!(typeof q === "number" && Number.isFinite(q))) return null;
		if (!(q > 0)) return null;
		return q;
	}

	function isInputTooLargeError(e) {
		const msg = String(e && e.message != null ? e.message : e);
		return /input\s+is\s+too\s+large|too\s+large/i.test(msg);
	}

	async function safeSummarize(s, text, context) {
		try {
			return await s.summarize(text, { context });
		} catch (e) {
			if (isInputTooLargeError(e) && String(context || "").trim()) {
				return await s.summarize(text, { context: "" });
			}
			throw e;
		}
	}

	async function clipTextToUsage(s, text, maxUsage) {
		const t = String(text || "");
		if (!t) return "";
		if (!(typeof maxUsage === "number" && Number.isFinite(maxUsage) && maxUsage > 0)) return t;
		let cur = t;
		for (let i = 0; i < 10; i++) {
			const u = await safeMeasureInputUsage(s, cur);
			if (u == null || !Number.isFinite(u) || u <= maxUsage) return cur;
			if (cur.length <= 1) return "";
			cur = cur.slice(0, Math.max(1, Math.floor(cur.length / 2)));
		}
		return cur;
	}

	async function summarizeQuotaAware(s, input, context, reducePass) {
		const text = String(input || "").trim();
		if (!text) return "";
		const quota = normalizeQuota(s && s.inputQuota);
		if (quota == null) return String(await safeSummarize(s, text, context) ?? "");

		const safetyMargin = 64;
		let ctx = String(context || "");
		if (ctx.trim()) {
			const ctxBudget = Math.max(1, Math.floor(quota * 0.25));
			ctx = await clipTextToUsage(s, ctx, ctxBudget);
		}
		const ctxUsage0 = await safeMeasureInputUsage(s, ctx);
		const ctxUsage = (ctxUsage0 != null && Number.isFinite(ctxUsage0)) ? ctxUsage0 : 0;
		const allowedQuota = Math.max(1, Math.floor(quota - ctxUsage - safetyMargin));

		const usage = await safeMeasureInputUsage(s, text);
		if (usage != null && Number.isFinite(usage) && usage <= allowedQuota) {
			return String(await safeSummarize(s, text, ctx) ?? "");
		}

		const targetPct = 0.40;
		const targetUsage = Math.max(1, Math.floor(allowedQuota * targetPct));
		const overlapChars = 200;
		const parts = (await chunkToTargetUsage(s, text, allowedQuota, targetUsage, overlapChars)).filter(x => String(x || "").trim());
		if (parts.length <= 1) {
			return String(await safeSummarize(s, text, ctx) ?? "");
		}

		const summaries = [];
		for (const part of parts) {
			const piece = String(await safeSummarize(s, part, ctx) ?? "");
			if (piece && piece.trim()) summaries.push(piece.trim());
		}
		const seen = new Set();
		const deduped = [];
		for (const sum of summaries) {
			const key = String(sum || "").trim().replace(/\s+/g, " ").toLowerCase();
			if (!key) continue;
			if (seen.has(key)) continue;
			seen.add(key);
			deduped.push(sum);
		}
		const combined = deduped.join("\n").trim();
		if (!combined) return "";

		const reduceMaxPasses = 2;
		if ((typeof reducePass !== "number" ? 0 : reducePass) >= reduceMaxPasses) return combined;
		const combinedUsage = await safeMeasureInputUsage(s, combined);
		if (combinedUsage != null && Number.isFinite(combinedUsage) && combinedUsage <= allowedQuota) {
			return combined;
		}
		return await summarizeQuotaAware(s, combined, ctx, (reducePass || 0) + 1);
	}
`;
