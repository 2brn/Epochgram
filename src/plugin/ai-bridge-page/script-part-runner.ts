export const AI_BRIDGE_SCRIPT_PART3 = String.raw`

	function withTimeout(promise, ms, label) {
		const timeoutMs = (typeof ms === "number" && Number.isFinite(ms)) ? Math.max(1000, ms) : 60000;
		let timer = 0;
		return new Promise((resolve, reject) => {
			timer = window.setTimeout(() => {
				reject(new Error((label ? (String(label) + ": ") : "") + "timed out"));
			}, timeoutMs);
			Promise.resolve(promise)
				.then(resolve)
				.catch(reject)
				.finally(() => {
					try { window.clearTimeout(timer); } catch {}
				});
		});
	}

	let lastWakeTickAt = Date.now();
	let pageClosing = false;
	let statusPollTimer = 0;
	let autoStartTimer = 0;
	let lastSummaryPreview = "";
	const AUTO_START_DELAY_MS = 3500;

	function shouldRetrySummarizeError(msg) {
		try {
			const t = String(msg || "").trim();
			if (!t) return true;
			// Don't spin on known non-retryable failures.
			if (/\b(summarizer api missing|model not available in this chromium runtime)\b/i.test(t)) return false;
			return true;
		} catch {
			return true;
		}
	}

	async function retryUpTo3(fn, label) {
		let lastErr = null;
		for (let attempt = 1; attempt <= 3; attempt++) {
			try {
				return await fn(attempt);
			} catch (e) {
				lastErr = e;
				const msg = String(e && e.message ? e.message : e);
				const canRetry = shouldRetrySummarizeError(msg);
				if (!canRetry || attempt >= 3) throw e;
				// Backoff a bit to avoid hammering the API.
				const delay = 500 * attempt;
				try { setErrText((label ? (String(label) + ": ") : "") + "error; retrying (" + attempt + "/3)...\n\n" + msg); } catch {}
				await new Promise(r => setTimeout(r, delay));
			}
		}
		throw lastErr || new Error("Retry failed");
	}
	function teardownBridgePage(reason) {
		try { void reason; } catch {}
		if (pageClosing) return;
		pageClosing = true;
		try {
			// Use sendBeacon so the server learns about the close even during unload.
			if (navigator && typeof navigator.sendBeacon === "function") {
				navigator.sendBeacon(API("bye"), "");
			}
		} catch {
			// ignore
		}
		try { running = false; } catch {}
		try { if (autoStartTimer) window.clearTimeout(autoStartTimer); } catch {}
		autoStartTimer = 0;
		try { if (statusPollTimer) window.clearInterval(statusPollTimer); } catch {}
		statusPollTimer = 0;
		try { if (perfUiTimer) window.clearInterval(perfUiTimer); } catch {}
		try { if (optionsSaveTimer) window.clearTimeout(optionsSaveTimer); } catch {}
		try { abortAllBridgeRequests(); } catch {}
	}
	function onWakeOrFocus(reason) {
		try {
			const now = Date.now();
			const gap = now - (lastWakeTickAt || 0);
			lastWakeTickAt = now;
			// After long sleep, clear cached summarizers (Chrome can invalidate them).
			if (gap > 45_000) {
				try { summarizersByKey.clear(); } catch {}
				try { languageDetector = null; } catch {}
			}
			void refreshStatus();
		} catch {
		}
	}

	try {
		window.addEventListener("focus", () => onWakeOrFocus("focus"));
		document.addEventListener("visibilitychange", () => {
			if (document.visibilityState === "visible") onWakeOrFocus("visible");
		});
		window.addEventListener("pagehide", () => teardownBridgePage("pagehide"));
		window.addEventListener("beforeunload", () => teardownBridgePage("beforeunload"));
	} catch {
	}

    async function loop() {
      running = true;
		try { setErrText(""); } catch { try { errEl.textContent = ""; } catch {} }
      while (running) {
				if (pageClosing) break;
				let job = null;
				let outputLanguage = null;
				let expectedInputLanguages = null;
				let expectedContextLanguages = null;
				let perCallContext = "";
        try {
          await refreshStatus();
						if (pageClosing) break;
					if (!running) break;
					job = await get("nextJob");
          if (!job || !job.id) {
            curEl.textContent = "idle";
            await new Promise(r => setTimeout(r, 500));
            continue;
          }

          const approxTokens = Math.ceil((job.input?.length || 0) / 4);
					const filePathStr = String(job.filePath || "");
					const dateStr = String(job.date || "").trim();
					const datePart = (dateStr && !filePathStr.startsWith("epoch://")) ? (" | date: " + dateStr) : "";
					curEl.textContent =
						"processing: " + filePathStr +
						datePart +
						" | chars: " + (job.input?.length || 0) +
						" | ~tokens: " + approxTokens;
			{
				curTextEl.textContent = String(job.input || "");
			}

			const jobSettings = (typeof buildBridgeSettingsForJob === "function")
				? buildBridgeSettingsForJob(job)
				: null;
			const kindKey = (job && job.kind === "epoch") ? "epoch" : "summary";
			const langs = (typeof readSelectedBridgeLanguages === "function")
				? readSelectedBridgeLanguages(kindKey)
				: { outputLanguage: "en", expectedInputLanguages: ["en", "ja", "es"], expectedContextLanguages: ["en"] };
			outputLanguage = (jobSettings && typeof jobSettings.outputLanguage === "string")
				? jobSettings.outputLanguage
				: langs.outputLanguage;
			expectedInputLanguages = (jobSettings && Array.isArray(jobSettings.expectedInputLanguages))
				? jobSettings.expectedInputLanguages
				: langs.expectedInputLanguages;
			expectedContextLanguages = (jobSettings && Array.isArray(jobSettings.expectedContextLanguages))
				? jobSettings.expectedContextLanguages
				: langs.expectedContextLanguages;
			const isEpoch = kindKey === "epoch";
			const typeFallback = isEpoch ? "headline" : "headline";
			const lengthFallback = isEpoch ? "long" : "long";
			const type = (jobSettings && jobSettings.type)
				? jobSettings.type
				: typeFallback;
			const length = (jobSettings && jobSettings.length)
				? jobSettings.length
				: lengthFallback;
			const summarizerOpts = {
				type,
				length,
				format: (jobSettings && jobSettings.format) ? jobSettings.format : FIXED_SUMMARIZER.format,
				preference: (jobSettings && jobSettings.preference) ? jobSettings.preference : "auto",
				sharedContext: (jobSettings && typeof jobSettings.sharedContext === "string") ? jobSettings.sharedContext : "",
				jobSpecificContext: (jobSettings && typeof jobSettings.jobSpecificContext === "string") ? jobSettings.jobSpecificContext : ""
			};
			if (pageClosing) break;
			perCallContext = (() => {
				const rendered = renderContextTemplate(summarizerOpts.jobSpecificContext || "", job, summarizerOpts);
				const ctx = rendered && String(rendered).trim() ? rendered : (job && job.context ? job.context : "");
				return ctx;
			})();
			const out = await retryUpTo3(async (attempt) => {
				// After a failure, clear cached summarizers; Chrome can invalidate them.
				if (attempt > 1) {
					try { summarizersByKey.clear(); } catch {}
					try { languageDetector = null; } catch {}
				}
				const s = await ensureSummarizer({
					outputLanguage,
					expectedInputLanguages,
					expectedContextLanguages,
					type: summarizerOpts.type,
					length: summarizerOpts.length,
					format: summarizerOpts.format,
					preference: summarizerOpts.preference,
					sharedContext: summarizerOpts.sharedContext
				});
				// If a queue built up while the model was downloading, refresh once
				// so the status UI flips to ready before heavy processing begins.
				try { await refreshStatus(); } catch {}
				return await withTimeout(
					summarizeQuotaAware(s, job.input, perCallContext, 0),
					120000,
					"summarize"
				);
			}, "summarize");
			if (pageClosing) break;
          const outStr = String(out ?? "");
          if (/^Model not available in Chromium\b/i.test(outStr)) {
            throw new Error("Summarizer model not available in this Chromium runtime");
          }
			try { applyDownloadProgress(1, true); } catch {}
          await post("submitResult", { id: job.id, summary: outStr, outputChars: outStr.length });
			{
				const clipped = outStr.length > 20000 ? (outStr.slice(0, 20000) + "\n…(truncated)") : outStr;
				lastSummaryPreview = clipped;
				if (sumResultEl) sumResultEl.textContent = clipped;
			}
				try { setErrText(""); } catch { try { errEl.textContent = ""; } catch {} }
        } catch (e) {
					const msg = String(e && e.message ? e.message : e);
					let details = msg;
					try {
						const templates = (() => { try { return pickTemplatesForJob(job); } catch { return null; } })();
						const opt = templates ? Object.assign({}, summarizerOpts, templates) : Object.assign({}, summarizerOpts);
						const langPayload = {
							outputLanguage: (typeof outputLanguage === "string" ? outputLanguage : null),
							expectedInputLanguages: (Array.isArray(expectedInputLanguages) ? expectedInputLanguages : null),
							expectedContextLanguages: (Array.isArray(expectedContextLanguages) ? expectedContextLanguages : null)
						};
						details = formatJobErrorMessage({ msg, job, opts: opt, langs: langPayload, context: perCallContext });
					} catch {
					}
					try { setErrText(details); } catch { try { errEl.textContent = details; } catch {} }
				if (job && job.id) {
				try { await post("submitResult", { id: job.id, error: details }); } catch {}
				} else {
				try { await post("submitResult", { id: null, error: details }); } catch {}
				}
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }

		async function start() {
			if (pageClosing) return;
			if (running) return;
			try { setErrText(""); } catch { try { errEl.textContent = ""; } catch {} }
			try { await detect(); } catch {}
			loop();
		}

		(async () => {
			try {
				const local = loadOptionsState();
				const saved = await fetchSavedOptionsFromObsidian();
				const merged = mergeOptionsState(local, (saved && typeof saved === "object") ? saved : null);
				applyOptionsStateToUi(merged);
				writeOptionsState(merged);
				wireOptionsPersistence();
				void postSavedOptionsToObsidian(merged);
			} catch {
				try { applyOptionsStateToUi(loadOptionsState()); wireOptionsPersistence(); } catch {}
			}
		})();

		if (clearQueueBtn) {
			clearQueueBtn.addEventListener("click", async () => {
				try {
					try { setErrText(""); } catch { try { errEl.textContent = ""; } catch {} }
					await post("clearQueue", {});
					curEl.textContent = "idle";
					lastSummaryPreview = "";
					curTextEl.textContent = "";
					if (sumResultEl) sumResultEl.textContent = "";
					await refreshStatus();
				} catch (e) {
					const msg = String(e && e.message ? e.message : e);
					try { setErrText(msg); } catch { try { errEl.textContent = msg; } catch {} }
				}
			});
		}

		try { startPerfUiTicker(); } catch {}
		function startStatusPolling() {
			if (statusPollTimer) return;
			statusPollTimer = window.setInterval(() => {
				if (pageClosing) return;
				const now = Date.now();
				const gap = now - (lastWakeTickAt || 0);
				if (gap > 45_000) {
					onWakeOrFocus("tick");
				}
				lastWakeTickAt = now;
				refreshStatus();
			}, 500);
		}
		autoStartTimer = window.setTimeout(() => {
			autoStartTimer = 0;
			if (pageClosing) return;
			start();
			startStatusPolling();
		}, AUTO_START_DELAY_MS);
`;
