
export const AI_BRIDGE_SCRIPT_PART1_CHUNK_B = String.raw`
	function setStatusBackground(mode) {
		if (!statusEl) return;
		if (mode === "downloading" || mode === "downloadable") {
			const pct = mode === "downloadable" ? 0 : clamp01(statusState.progress);
			const pctPercent = Math.round(pct * 1000) / 10;
			const stop = Math.max(0, Math.min(100, pctPercent));
			statusEl.style.backgroundImage = "linear-gradient(90deg, rgba(138, 180, 248, 0.25) 0%, rgba(138, 180, 248, 0.35) " + stop + "%, rgba(30, 30, 30, 0.4) " + stop + "%, rgba(30, 30, 30, 0.4) 100%)";
			statusEl.style.padding = "2px 8px";
			statusEl.style.borderRadius = "8px";
			statusEl.style.display = "inline-block";
		} else {
			statusEl.style.backgroundImage = "";
			statusEl.style.padding = "";
			statusEl.style.borderRadius = "";
			statusEl.style.display = "";
		}
	}

	function renderStatusText() {
		if (!statusEl) return;
		const mode = statusState.mode;
		const backendMode = (() => {
			try {
				if (typeof getRootBackendConfig === "function") {
					const cfg = getRootBackendConfig();
					return String(cfg && cfg.mode ? cfg.mode : "native").trim().toLowerCase() === "cloud" ? "cloud" : "native";
				}
			} catch { void 0; }
			return "native";
		})();
		setStatusBackground(mode);
		try {
			if (downloadBtn) downloadBtn.style.display = (mode === "downloadable") ? "inline-block" : "none";
		} catch { void 0; }
		if (mode === "unknown") {
			statusEl.textContent = "Checking…";
			return;
		}
		if (mode === "api-missing") {
			if (backendMode === "cloud") {
				statusEl.textContent = "Cloud not ready";
				return;
			}
			try {
				statusEl.textContent = "";
				statusEl.appendChild(document.createTextNode("API not detected, download the latest "));
				const link = document.createElement("a");
				link.href = CHROME_UPDATE_URL;
				link.target = "_blank";
				link.rel = "noreferrer";
				link.textContent = "compatible browser";
				statusEl.appendChild(link);
				statusEl.appendChild(document.createTextNode("."));
			} catch {
				statusEl.textContent = "API not detected";
			}
			return;
		}
		if (mode === "unavailable") {
			statusEl.textContent = "Summarizer unavailable";
			return;
		}
		if (mode === "downloadable") {
			if (backendMode === "cloud") {
				statusEl.textContent = "Cloud ready";
				return;
			}
			statusEl.textContent = "Model downloading";
			return;
		}
		if (mode === "downloading") {
			if (backendMode === "cloud") {
				statusEl.textContent = "Cloud ready";
				return;
			}
			const pct = clamp01(statusState.progress);
			const percentText = (pct * 100).toFixed(2);
			const suffix = " (" + percentText + "%)";
			statusEl.textContent = "Model downloading" + suffix;
			return;
		}
		if (mode === "ready") {
			statusEl.textContent = backendMode === "cloud" ? "Cloud ready" : "Native ready";
			return;
		}
	}

	function setStatusMode(mode, detail) {
		statusState.mode = mode;
		if (mode === "downloading") {
			const raw = detail && typeof detail.progress === "number" ? detail.progress : null;
			const normalized = raw == null ? null : normalizeProgressOrNull(raw);
			if (normalized != null) {
				statusState.progress = normalized;
			}
		}
		renderStatusText();
	}

	function setApiNotDetectedStatus() {
		setStatusMode("api-missing");
	}

	function setUnavailableStatus() {
		setStatusMode("unavailable");
	}

	function setDownloadableStatus() {
		setStatusMode("downloadable");
	}

	function setModelDownloadingStatus(progress) {
		// Downloading *mode* should come only from Summarizer.availability() via detect().
		// Progress itself is driven by live downloadprogress events.
		try {
			if (typeof getRootBackendConfig === "function") {
				const cfg = getRootBackendConfig();
				const mode = String(cfg && cfg.mode ? cfg.mode : "native").trim().toLowerCase();
				if (mode === "cloud") {
					setModelReadyStatus();
					return;
				}
			}
		} catch { void 0; }
		if (typeof progress !== "number") return;
		const normalized = normalizeProgressOrNull(progress);
		if (normalized == null) return;
		statusState.progress = normalized;
		if (statusState.mode === "downloading") {
			renderStatusText();
		}
	}

	function setModelReadyStatus() {
		setStatusMode("ready");
	}

	function resetDownloadProgressState(options) {
		if (!downloadProgressState || typeof downloadProgressState !== "object") return;
		const wantSoft = !!(options && options.soft);
		downloadProgressState.fileCount = 0;
		if (downloadProgressState.files && typeof downloadProgressState.files.clear === "function") {
			downloadProgressState.files.clear();
		} else {
			try {
				downloadProgressState.files = new Map();
			} catch {
				// ignore
			}
		}
		if (wantSoft) return;
		statusState.progress = null;
	}

	function aggregateDownloadProgressEvent(event) {
		const result = { progress: null, reset: false };
		if (!event) return result;
		const total = typeof event.total === "number" && Number.isFinite(event.total) && event.total > 0 ? event.total : null;
		let perFile = 0;
		if (total) {
			const loaded = Number(event.loaded ?? 0);
			const ratio = loaded / total;
			const normalized = normalizeProgressOrNull(ratio);
			if (normalized == null) return result;
			perFile = normalized;
		} else {
			const normalized = normalizeProgressOrNull(event.loaded ?? 0);
			if (normalized == null) return result;
			perFile = normalized;
		}
		const fileCountRaw = typeof event.fileCount === "number" && Number.isFinite(event.fileCount) && event.fileCount > 0
			? Math.max(1, Math.floor(event.fileCount))
			: null;
		const fileIndex = typeof event.fileIndex === "number" && Number.isFinite(event.fileIndex) && event.fileIndex >= 0
			? Math.max(0, Math.floor(event.fileIndex))
			: 0;
		if (fileCountRaw && downloadProgressState && downloadProgressState.files && typeof downloadProgressState.files.set === "function") {
			downloadProgressState.fileCount = fileCountRaw;
			try {
				downloadProgressState.files.set(fileIndex, perFile);
			} catch {
				// ignore
			}
			let sum = 0;
			let count = 0;
			try {
				for (const value of downloadProgressState.files.values()) {
					const normalized = normalizeProgressOrNull(value);
					if (normalized == null) continue;
					sum += normalized;
					count++;
				}
			} catch {
				// ignore
			}
			const divisor = Math.max(fileCountRaw, count, 1);
			result.progress = clamp01(sum / divisor);
			return result;
		}
		result.progress = perFile;
		return result;
	}

	function applyDownloadProgress(progress, ready, options) {
		try {
			if (typeof getRootBackendConfig === "function") {
				const cfg = getRootBackendConfig();
				const mode = String(cfg && cfg.mode ? cfg.mode : "native").trim().toLowerCase();
				if (mode === "cloud") {
					setModelReadyStatus();
					return 1;
				}
			}
		} catch { void 0; }
		const normalized = normalizeProgressOrNull(progress);
		if (normalized == null) {
			return null;
		}
		let clamped = normalized;
		const reset = !!(options && options.reset);
		const current = clamp01(statusState.progress);
		if (!reset && clamped + 0.0001 < current) {
			clamped = current;
		}
		if (reset && clamped < 0.01) {
			clamped = 0.02;
		}
		lastProgress = ready ? 1 : clamped;
		const shouldMarkReady = ready === true;
		if (shouldMarkReady) {
			setModelReadyStatus();
			return 1;
		}
		setModelDownloadingStatus(clamped);
		return clamped;
	}
	let perfUiTimer = 0;
	let perfUiInitialized = false;
	let statusFreshForPerf = false;
	let stableProcessedTokens = 0;
	let stableProcessedUpdatedAt = 0;
	let refreshStatusPromise = null;
	function computeRemainingPct(remainingTokens, processedTokens, errorTokens) {
		const rem = Math.max(0, Number(remainingTokens) || 0);
		const processed = Math.max(0, Number(processedTokens) || 0);
		const errors = Math.max(0, Number(errorTokens) || 0);
		const total = rem + processed + errors;
		return total > 0 ? (rem / total) : 0;
	}
	function resetPerfUiHistory(now, processedTokens, remainingTokens, errorTokens) {
		perfUiInitialized = true;
		lastSampleAt = now;
		lastDone = processedTokens;
		speedSeries = [0];
		const seedRemainingPct = Math.max(0, Math.min(1, computeRemainingPct(remainingTokens, processedTokens, errorTokens)));
		remainingPctSeries = [seedRemainingPct];
		if (speedEl) speedEl.textContent = "0.0 tok/s";
		drawChart();
	}
	function stabilizeProcessedTokens(s, rawProcessed) {
		const now = Date.now();
		const queuedTokens = Number(s?.queuedTokens || 0);
		const inProgressTokens = Number(s?.inProgressTokens || 0);
		const errorTokens = Number(s?.errorTokens || 0);
		const activity = (queuedTokens + inProgressTokens + errorTokens) > 0;
		const candidate = Number.isFinite(rawProcessed) ? Math.max(0, rawProcessed) : 0;

		if (!Number.isFinite(stableProcessedTokens) || stableProcessedTokens < 0) {
			stableProcessedTokens = 0;
			stableProcessedUpdatedAt = now;
		}

		// If we have activity but processed suddenly drops, treat it as transient.
		if (activity && stableProcessedTokens > 0 && candidate < stableProcessedTokens) {
			return stableProcessedTokens;
		}

		// If we recently had a higher number, ignore a brief drop-to-zero glitch.
		if (stableProcessedTokens > 0 && candidate === 0 && now - stableProcessedUpdatedAt < 2000) {
			return stableProcessedTokens;
		}

		if (candidate !== stableProcessedTokens) {
			stableProcessedTokens = candidate;
			stableProcessedUpdatedAt = now;
		}
		return stableProcessedTokens;
	}
	function updatePerfUi() {
		try {
			if (!lastStatus) return;
			// If /status couldn't be fetched, still advance the chart (time moves),
			// but record a gap for the speed line so it doesn't "pulse".
			if (!statusFreshForPerf) {
				if (!perfUiInitialized || !lastSampleAt || !Number.isFinite(lastSampleAt)) return;
				const lastPct = (remainingPctSeries.length ? Number(remainingPctSeries[remainingPctSeries.length - 1]) : 0) || 0;
				speedSeries.push(null);
				if (speedSeries.length > 60) speedSeries = speedSeries.slice(speedSeries.length - 60);
				remainingPctSeries.push(lastPct);
				if (remainingPctSeries.length > 60) remainingPctSeries = remainingPctSeries.slice(remainingPctSeries.length - 60);
				if (remainingPctSeries.length !== speedSeries.length) {
					const n = Math.min(remainingPctSeries.length, speedSeries.length);
					speedSeries = speedSeries.slice(speedSeries.length - n);
					remainingPctSeries = remainingPctSeries.slice(remainingPctSeries.length - n);
				}
				drawChart();
				return;
			}
			statusFreshForPerf = false;
			const s = lastStatus;
			const queuedTokens = Number(s.queuedTokens || 0);
			const inProgressTokens = Number(s.inProgressTokens || 0);
			const processedTokensRaw = Number(s.processedTokens || 0);
			const processedTokens = stabilizeProcessedTokens(s, processedTokensRaw);
			const remainingTokens = queuedTokens + inProgressTokens;
			const epochQueuedTokens = Number(s.epochQueuedTokens || 0);
			const epochInProgressTokens = Number(s.epochInProgressTokens || 0);
			const epochRemainingTokens = Number(s.epochRemainingTokens || 0);
			const hasEpochRemaining = Number.isFinite(epochRemainingTokens) && epochRemainingTokens > 0;
			const baseNonEpoch = Math.max(0, remainingTokens - Math.max(0, epochQueuedTokens) - Math.max(0, epochInProgressTokens));
			const remainingTokensAllBuckets = hasEpochRemaining ? (baseNonEpoch + epochRemainingTokens) : remainingTokens;
			const errorTokens = Number(s.errorTokens || 0);
			const remainingPct = computeRemainingPct(remainingTokensAllBuckets, processedTokens, errorTokens);

			if (remainingEl) remainingEl.textContent = String(Math.max(0, Math.floor(remainingTokensAllBuckets))) + " tok";

			const now = Date.now();
			// Avoid a huge first sample if the page opens mid-queue.
			if (!perfUiInitialized || !lastSampleAt || !Number.isFinite(lastSampleAt)) {
				resetPerfUiHistory(now, processedTokens, remainingTokensAllBuckets, errorTokens);
				return;
			}

			const dt = Math.max(0.25, (now - lastSampleAt) / 1000);
			// Counters can reset (clear queue / reconnect); never show negative speed.
			const safeLastDone = processedTokens < lastDone ? processedTokens : lastDone;
			const dTok = processedTokens - safeLastDone;
			const tokPerSec = Math.max(0, (dTok / dt));
			if (speedEl) speedEl.textContent = tokPerSec.toFixed(1) + " tok/s";
			lastSampleAt = now;
			lastDone = processedTokens;
			speedSeries.push(tokPerSec);
			if (speedSeries.length > 60) speedSeries = speedSeries.slice(speedSeries.length - 60);
			remainingPctSeries.push(remainingPct);
			if (remainingPctSeries.length > 60) remainingPctSeries = remainingPctSeries.slice(remainingPctSeries.length - 60);
			if (remainingPctSeries.length !== speedSeries.length) {
				const n = Math.min(remainingPctSeries.length, speedSeries.length);
				speedSeries = speedSeries.slice(speedSeries.length - n);
				remainingPctSeries = remainingPctSeries.slice(remainingPctSeries.length - n);
			}
			drawChart();
		} catch {
			// ignore
		}
	}

	function startPerfUiTicker() {
		if (perfUiTimer) return;
		perfUiTimer = window.setInterval(updatePerfUi, 500);
		updatePerfUi();
	}

	    async function refreshStatus() {
			if (refreshStatusPromise) return await refreshStatusPromise;
			refreshStatusPromise = (async () => {
				// When the bridge is disconnected but the tab should stay open, retry with backoff.
				try {
					if (bridgeDisconnected && !shouldCloseOnDisconnect() && !shouldAttemptBridgeRetryNow()) {
						statusFreshForPerf = false;
						return;
					}
				} catch {
					// ignore
				}

				let s;
				try {
					s = await get("status");
				} catch (e) {
					const msg = String(e && e.message ? e.message : e);
					try { setErrText(msg); } catch { void 0; }
					running = false;
					statusFreshForPerf = false;
					try { handleBridgeDisconnected(msg); } catch { void 0; }
					return;
				}
				lastStatus = s;
				statusFreshForPerf = true;
				try { if (bridgeDisconnected) handleBridgeReconnected(); } catch { void 0; }

		const now = Date.now();
		const inStartupGrace = (now - BRIDGE_STARTUP_AT) < BRIDGE_STARTUP_GRACE_MS;

		// Client-driven model status (no server round-trips).
		try {
			if (!inStartupGrace && now - (lastDetectAt || 0) > 2000) {
				lastDetectAt = now;
				await detect();
			}
		} catch {
			// ignore
		}

		const queued = Number(s.queued || 0);
		const inProgress = Number(s.inProgress || 0);
		const remainingJobs = queued + inProgress;

		const queuedTokens = Number(s.queuedTokens || 0);
		const inProgressTokens = Number(s.inProgressTokens || 0);
		const processedTokens = stabilizeProcessedTokens(s, Number(s.processedTokens || 0));
		const errorTokens = Number(s.errorTokens || 0);
		const remainingTokens = queuedTokens + inProgressTokens;

		processedEl.textContent = processedTokens + " tok" + (errorTokens ? (" (errors: " + errorTokens + " tok)") : "");
		void remainingTokens;

		if (!inStartupGrace && !running && remainingJobs > 0) {
			if (now - lastAutoStartAt > 3000) {
				lastAutoStartAt = now;
				try {
					await start();
				} catch { void 0; }
			}
		}

				if (s.lastError) setText(errEl, s.lastError);
			})();
			try {
				return await refreshStatusPromise;
			} finally {
				refreshStatusPromise = null;
			}
	    }
`;
