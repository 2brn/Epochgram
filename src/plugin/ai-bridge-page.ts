import bridgeFaviconSvg from "epochgram-bridge-favicon";

import epochgramLogoFullSvg from "epochgram-logo-full";
import defaultBridgeSettingsYaml from "epochgram-bridge-default-settings-yaml";

import { AI_BRIDGE_SCRIPT_PART1 } from "./ai-bridge-page/script-part-ui";
import { AI_BRIDGE_SCRIPT_PART2 } from "./ai-bridge-page/script-part-detect";
import { AI_BRIDGE_SCRIPT_PART3 } from "./ai-bridge-page/script-part-runner";

export function buildAiBridgePageHtml(token: string): string {
	const faviconHref = `data:image/svg+xml,${encodeURIComponent(String(bridgeFaviconSvg || "").trim())}`;
	const titleLogoSvg = String(epochgramLogoFullSvg || "").trim();
	const htmlHead = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
	<meta name="referrer" content="no-referrer" />
	<link rel="icon" type="image/svg+xml" href="${faviconHref}" />
	<link rel="shortcut icon" href="${faviconHref}" />
	<title>Epochgram · AI Bridge</title>
  <style>
		:root { color-scheme: dark; }
		html, body { height: 100%; }
		* { box-sizing: border-box; }
		body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; padding: 16px; background: #1e1e1e; color: #d4d4d4; display: flex; flex-direction: column; min-height: 100vh; }
		h2 { margin: 0 0 8px 0; font-size: 18px; }
		.bridgeTitle svg { display: block; height: 20px; width: auto; }
		p { margin: 8px 0; }
		a { color: #8ab4f8; text-decoration: none; }
		a:hover { text-decoration: underline; }
		.row { display: flex; gap: 12px; flex: 1; min-height: 0; align-items: stretch; }
		.card { border: 1px solid #333; border-radius: 10px; padding: 12px; background: #262626; display: flex; flex-direction: column; flex: 1; min-width: 320px; min-height: 0; }
		.optionsCard { overflow-y: auto; overflow-x: hidden; min-height: 0; }
		.muted { color: #9aa0a6; }
		.wrap { overflow-wrap: anywhere; word-break: break-word; }
		.kv { display: grid; grid-template-columns: 140px 1fr; gap: 6px 12px; font-size: 13px; }
		.k { color: #9aa0a6; }
		.v { color: #d4d4d4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.warn { color: #ffd479; }
		.err { color: #ff8a8a; white-space: pre-wrap; }
		.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 12px; }
		.box { border: 1px solid #333; border-radius: 10px; padding: 10px; background: #1f1f1f; min-width: 0; }
		.pre { white-space: pre-wrap; word-break: break-word; overflow-y: auto; max-width: 100%; }
		button, select, textarea { background: #1f1f1f; color: #d4d4d4; border: 1px solid #333; border-radius: 8px; padding: 6px 8px; }
		select { padding: 6px 8px; }
		textarea { width: 100%; max-width: 100%; min-height: 0; resize: none; flex: 1; }
		#sumResult { width: 100%; overflow-y: auto; overflow-x: hidden; flex: 1; min-height: 0; }
		#curText { width: 100%; overflow-y: auto; overflow-x: hidden; flex: 1; min-height: 0; }
		#err { max-height: 10vh; overflow-y: auto; }
		.small { font-size: 12px; }
		.danger { border-color: #ff8a8a !important; color: #ff8a8a !important; }
		.cardFill { display: flex; flex-direction: column; flex: 0 0 auto; min-height: 0; }
		.statusBoxes { display: flex; flex-direction: column; gap: 10px; flex: 1; min-height: 0; }
		.statusGrow { flex: 1; min-height: 0; display: flex; flex-direction: column; }
		.settingsEditorWrap { position: relative; flex: 1; min-height: 200px; overflow: hidden; border-radius: 8px; background: #171717; }
		.settingsEditorWrap.invalid { box-shadow: 0 0 0 1px rgba(255, 138, 138, 0.8) inset; }
		.settingsYamlHighlight { position: absolute; inset: 0; margin: 0; pointer-events: none; white-space: pre; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; line-height: 1.45; padding: 10px; color: #b8b8b8; overflow: hidden; }
		.settingsYamlInput { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; border-radius: 8px; background: transparent; color: transparent; caret-color: #d4d4d4; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; line-height: 1.45; resize: none; padding: 10px; white-space: pre; overflow-y: auto; overflow-x: auto; }
		.settingsYamlInput:focus { outline: none; }
		.yamlKey { color: #9cdcfe; }
		.yamlPipe { color: #c586c0; }
		.yamlComment { color: #6a9955; }
		.yamlString { color: #ce9178; }
		.settingsErrors { margin-top: 8px; color: #ff8a8a; white-space: pre-wrap; }
  </style>
</head>
<body>
	<h2 class="bridgeTitle">${titleLogoSvg}</h2>
	<p class="muted">Uses Chrome’s built-in Summarizer locally. Keep this page open while AI summaries are generated.</p>

		<div class="row">
		<div class="card">
			<div><strong>Status</strong></div>
			<div class="kv" style="margin-top: 10px;">
				<div class="k">API</div><div class="v" id="status"></div>
				<div class="k">Processed</div><div id="processed" class="v"></div>
				<div class="k">Remaining</div><div id="remaining" class="v"></div>
				<div class="k">Speed</div><div id="speed" class="v"></div>
				<div class="k">Status</div><div id="cur" class="v"></div>
			</div>
			<div style="margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap;">
				<button id="clearQueue" type="button">Clear queue</button>
			</div>
			<div class="statusBoxes" style="margin-top: 10px;">
				<div class="box">
					<div class="muted" style="margin-bottom: 6px;">Processing speed (tokens/sec)</div>
					<canvas id="chart" width="520" height="70" style="width: 100%; height: 70px;"></canvas>
				</div>
				<div class="box statusGrow">
					<div class="muted" style="margin-bottom: 6px;">Text preview</div>
					<div id="curText" class="mono pre"></div>
				</div>
				<div class="box statusGrow">
					<div class="muted" style="margin-bottom: 6px;">Summarization result</div>
					<div id="sumResult" class="mono pre"></div>
				</div>
			</div>
			<div id="err" class="err box" style="margin-top: 10px; display: none;"></div>
    </div>

		<div class="card optionsCard">
			<div style="margin-bottom: 8px;"><strong>Settings</strong></div>
			<div class="settingsEditorWrap" id="settingsPanel" style="margin-top: 8px;">
				<pre id="settingsYamlHighlight" class="settingsYamlHighlight"></pre>
				<textarea id="settingsYaml" class="settingsYamlInput" spellcheck="false"></textarea>
			</div>
			<div id="settingsErrors" class="settingsErrors mono"></div>
			<div style="margin-top: 8px; display: flex; gap: 8px; flex-wrap: wrap;">
				<button id="resetDefaults" type="button">Reset to defaults</button>
			</div>
			<div style="margin-top: 10px;" class="box cardFill">
				<div><strong>Documentation</strong></div>
				<p class="muted">If the Summarizer API is unavailable, download the latest <a href="https://www.google.com/intl/uk/chrome/update/" target="_blank" rel="noreferrer">Google Chrome</a> and review the requirements.</p>
				<ul style="margin: 8px 0 0 18px;">
					<li><a href="https://developer.chrome.com/docs/ai/" target="_blank" rel="noreferrer">AI with Chrome</a></li>
					<li><a href="https://developer.chrome.com/docs/ai/summarizer-api/" target="_blank" rel="noreferrer">Summarizer API</a></li>
					<li><a href="https://chrome.dev/web-ai-demos/summarization-api-playground/" target="_blank" rel="noreferrer">Summarization API Playground</a></li>
				</ul>
				<p class="muted mono" style="margin-top: 12px;">Tip: if a model download is required, Chrome may require a user gesture or restart.</p>
			</div>
    </div>
  </div>

  <script>
    const TOKEN = ${JSON.stringify(token)};
	const API = (p) => "/api/" + p + "?token=" + encodeURIComponent(TOKEN);

	const $ = (id) => document.getElementById(id);
	const statusEl = $("status");
	if (statusEl) statusEl.textContent = "Initializing…";
	const downloadBtn = $("downloadBtn");
	const processedEl = $("processed");
	const remainingEl = $("remaining");
	const speedEl = $("speed");
    const curEl = $("cur");
	const curTextEl = $("curText");
	const sumResultEl = $("sumResult");
	const errEl = $("err");
	const clearQueueBtn = $("clearQueue");
	const settingsPanelEl = $("settingsPanel");
	const settingsYamlEl = $("settingsYaml");
	const settingsYamlHighlightEl = $("settingsYamlHighlight");
	const settingsErrorsEl = $("settingsErrors");
	const resetDefaultsBtn = $("resetDefaults");
	const chart = $("chart");
	const chartCtx = chart && chart.getContext ? chart.getContext("2d") : null;

	let languageDetector = null;
	const summarizersByKey = new Map();
	let running = false;
    let lastProgress = null;
	let lastProgressPostAt = 0;
	let lastSampleAt = Date.now();
	let lastDone = 0;
	let lastAutoStartAt = 0;
	let speedSeries = [];
	let remainingPctSeries = [];
	let lastStatus = null;
	let openedUpdateLink = false;
	const CHROME_UPDATE_URL = "https://www.google.com/intl/uk/chrome/update/";
	const OPTS_KEY = "epoch_ai_bridge_yaml_v1";
	let optionsSaveTimer = 0;
	let optionsValidationTimer = 0;
	let optionsState = null;
	const BUILTIN_DEFAULTS = {
		settingsYaml: ${JSON.stringify(defaultBridgeSettingsYaml)}
	};
	const FIXED_SUMMARIZER = { format: "plain-text" };
	const downloadProgressState = { fileCount: 0, files: new Map() };

`;

	const htmlTail = String.raw`
  </script>
</body>
</html>`;

	return (
		htmlHead +
		AI_BRIDGE_SCRIPT_PART1 +
		AI_BRIDGE_SCRIPT_PART2 +
		AI_BRIDGE_SCRIPT_PART3 +
		htmlTail
	);
}
