import type { EpochCanvas } from "../epoch-canvas";
import type { DateEntry } from "../../indexer/types";
import { BASE_SPACING, HOVER_HIT_PAD, SUMMARY_ICON_PIN, TOUCH_HIT_PAD } from "../epoch-canvas-constants";
import { resolveDateKeyForCanvasDrop } from "../../plugin/date-frontmatter";
import { normalizePath, TFile, TFolder } from "obsidian";
import { parseDateFromDailyNoteFormat } from "../../utils";
import { parseAnyDate, parseAnyDates } from "../../indexer/extractor";
import { entrySummaryComponents } from "../epoch-canvas-utils";
import { setCssStyles } from "../../dom";


type DragSource = "mouse" | "touch";

type EntryLike = DateEntry & {
	file?: string;
	date?: string;
	source?: string;
	pinned?: boolean;
	originalDate?: string;
	blockStart?: number;
	blockEnd?: number;
};

type SummaryRectLike = {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	entry?: EntryLike | null;
};

type LayoutLike = {
	index?: number;
	y?: number;
	summaryRects?: SummaryRectLike[];
	summaryHoverRects?: SummaryRectLike[];
};

type DragGhost = {
	img: HTMLCanvasElement;
	w: number;
	h: number;
	offsetX: number;
	offsetY: number;
	x: number;
	y: number;
};

type VaultLike = {
	getAbstractFileByPath: (path: string) => TFile | TFolder | null;
	createFolder: (path: string) => Promise<void>;
	rename: (file: TFile, newPath: string) => Promise<void>;
};

type AppLike = {
	vault: VaultLike;
};

type PluginLike = {
	app: AppLike;
	settings?: {
		enableAnimation?: boolean;
	};
	getDailyNoteFormat?: () => string;
	getDailyNoteFolder?: () => string;
	setYamlDateForPath?: (path: string, dateKey: string) => Promise<void>;
};

type AnchorDndState = {
	canvas: HTMLCanvasElement;
	ctx: CanvasRenderingContext2D;
	win?: Window;
	scale?: number;
	layouts?: LayoutLike[];
	index?: Record<string, DateEntry[]>;
	offsetY: number;
	keepHoverUntilPointerMove?: boolean;
	hoverSummary?: unknown;
	animSummary?: unknown;
	hoverDateIndex?: number | null;
	animDateIndex?: number | null;
	hoverTarget?: number;
	plugin?: PluginLike;
	getToday: () => Date;
	getDateForIndex: (index: number, today: Date) => Date;
	clearHover: (force?: boolean) => void;
	requestHoverAnimation: () => void;
	draw: () => void;
	entryDragActive: boolean;
	entryDragEntry: DateEntry | null;
	entryDragSource: DragSource | null;
	entryDragTargetDayIndex: number | null;
	entryDragLastClientX: number;
	entryDragLastClientY: number;
	entryDragLastLocalX: number;
	entryDragLastLocalY: number;
	entryDragGhost: DragGhost | null;
	entryDragGhostSourceEntry: DateEntry | null;
	entryDragGhostAttemptedAt: number;
	entryDragAutoScrollRaf: number | null;
	entryDragAutoScrollLastAt: number;
};

function getAnchorDndState(canvas: EpochCanvas): AnchorDndState {
	return canvas as unknown as AnchorDndState;
}

function asEntryLike(entry: DateEntry | null | undefined): EntryLike | null {
	return entry ?? null;
}

function getEntryFile(entry: DateEntry | null | undefined): string {
	return String(asEntryLike(entry)?.file ?? "");
}

function getEntryDate(entry: DateEntry | null | undefined): string {
	return String(asEntryLike(entry)?.date ?? "");
}

function getEntrySource(entry: DateEntry | null | undefined): string {
	return String(asEntryLike(entry)?.source ?? "");
}

function getEntryPinned(entry: DateEntry | null | undefined): boolean {
	return asEntryLike(entry)?.pinned === true;
}

function getEntryOriginalDate(entry: DateEntry | null | undefined): string {
	return String(asEntryLike(entry)?.originalDate ?? "");
}

function getEntryBlockStart(entry: DateEntry | null | undefined): number {
	const raw = asEntryLike(entry)?.blockStart;
	return typeof raw === "number" ? raw : -1;
}

function getEntryBlockEnd(entry: DateEntry | null | undefined): number {
	const raw = asEntryLike(entry)?.blockEnd;
	return typeof raw === "number" ? raw : -1;
}

function isEpochEntry(entry: DateEntry | null | undefined): boolean {
	try {
		const file = getEntryFile(entry);
		return file.startsWith("epoch://");
	} catch {
		return false;
	}
}

function isSyntheticPinnedTodayClone(entry: DateEntry | null | undefined): boolean {
	try {
		if (!entry || !getEntryPinned(entry)) return false;
		const originalDate = getEntryOriginalDate(entry).trim();
		const date = getEntryDate(entry).trim();
		return !!originalDate && !!date && originalDate !== date;
	} catch {
		return false;
	}
}

export function isDraggableAnchorEntry(entry: DateEntry | null | undefined): boolean {
	if (!entry) return false;
	if (isEpochEntry(entry)) return false;
	if (isSyntheticPinnedTodayClone(entry)) return false;
	const src = getEntrySource(entry);
	if (!(src === "cdate" || src === "namedate" || src === "dateprop")) return false;
	const file = getEntryFile(entry).trim();
	if (!file) return false;
	try {
		const icons = entrySummaryComponents(entry)?.iconIds ?? [];
		if (Array.isArray(icons) && icons.length > 0) {
			const todayKey = resolveDateKeyForCanvasDrop(new Date());
			const isMd = file.toLowerCase().endsWith(".md");
			const isPinnedAnchorOnToday =
				isMd &&
				getEntryPinned(entry) &&
				getEntryDate(entry).trim() === todayKey &&
				icons.length === 1 &&
				icons[0] === SUMMARY_ICON_PIN;
			if (!isPinnedAnchorOnToday) return false;
		}
	} catch {
		// If icon computation fails, default to non-draggable to avoid unexpected moves.
		return false;
	}
	return true;
}

export function resolveDraggableAnchorEntry(canvas: EpochCanvas, hit: DateEntry | null | undefined): DateEntry | null {
	if (!hit) return null;
	if (isDraggableAnchorEntry(hit)) return hit;
	if (isEpochEntry(hit)) return null;

	const file = getEntryFile(hit).trim();
	if (!file) return null;

	// Prefer resolving within the day the user is interacting with.
	const dateKeyRaw = getEntryDate(hit).trim();
	if (!dateKeyRaw) return null;

	const s = getAnchorDndState(canvas);
	const rawEntries: DateEntry[] | undefined = s.index?.[dateKeyRaw];
	if (!Array.isArray(rawEntries) || rawEntries.length === 0) return null;

	const anchors = rawEntries
		.filter((e) => e && getEntryFile(e).trim() === file)
		.filter((e) => isDraggableAnchorEntry(e));
	if (anchors.length === 0) return null;
	return (
		anchors.find((e) => getEntrySource(e) === "dateprop") ||
		anchors.find((e) => getEntrySource(e) === "namedate") ||
		anchors.find((e) => getEntrySource(e) === "cdate") ||
		anchors[0] ||
		null
	);
}

function clearDragState(s: AnchorDndState): void {
	s.entryDragActive = false;
	s.entryDragEntry = null;
	s.entryDragSource = null;
	s.entryDragTargetDayIndex = null;
	s.entryDragLastClientX = 0;
	s.entryDragLastClientY = 0;
	s.entryDragLastLocalX = 0;
	s.entryDragLastLocalY = 0;
	s.entryDragGhost = null;
	s.entryDragGhostSourceEntry = null;
	s.entryDragGhostAttemptedAt = 0;
	try {
		if (s.entryDragAutoScrollRaf != null) {
			window.cancelAnimationFrame(s.entryDragAutoScrollRaf);
		}
	} catch {
		// ignore
	}
	s.entryDragAutoScrollRaf = null;
	s.entryDragAutoScrollLastAt = 0;
	try {
		setCssStyles(s.canvas, { cursor: "" });
	} catch {
		// ignore
	}
}

function splitDailyVariantSuffix(stem: string): { core: string; suffix: string } {
	const s = String(stem ?? "");
	const m = s.match(/^(.*?)( \(\d+\))$/);
	if (!m) return { core: s, suffix: "" };
	return { core: String(m[1] ?? ""), suffix: String(m[2] ?? "") };
}

function normalizeDailyFolderInput(rawFolder: string): string {
	const folder = String(rawFolder || "")
		.trim()
		.replace(/\\/g, "/")
		.replace(/\/+$|^\/+?/g, "")
		.replace(/\/+$/, "")
		.replace(/^\/+/, "");
	return folder;
}

function getDailyNoteInfoForPath(
	plugin: PluginLike,
	pathRaw: string
): { suffix: string; core: string; format: string; folder: string } | null {
	try {
		const path = normalizePath(String(pathRaw || ""));
		if (!path.toLowerCase().endsWith(".md")) return null;
		const format = typeof plugin?.getDailyNoteFormat === "function" ? String(plugin.getDailyNoteFormat() || "").trim() : "";
		if (!format) return null;
		const folderRaw = typeof plugin?.getDailyNoteFolder === "function" ? String(plugin.getDailyNoteFolder() || "") : "/";
		const folder = normalizeDailyFolderInput(folderRaw);

		const lowerPath = path.toLowerCase();
		let rel = path;
		if (folder) {
			const folderLower = folder.toLowerCase();
			if (!(lowerPath === folderLower || lowerPath.startsWith(folderLower + "/"))) return null;
			rel = path.slice(folder.length + 1);
		}
		if (!rel) return null;
		const relNoExt = rel.replace(/\.md$/i, "");
		const { core, suffix } = splitDailyVariantSuffix(relNoExt);
		const parsed = parseDateFromDailyNoteFormat(core, format);
		if (!parsed) return null;
		return { suffix, core, format, folder };
	} catch {
		return null;
	}
}

function rewriteDailyCoreDate(core: string, formatRaw: string, dateKey: string): string | null {
	const format = String(formatRaw || "");
	const m = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!m) return null;
	const yyyy = String(m[1] ?? "");
	const yy = yyyy.slice(-2);
	const mm = String(m[2] ?? "");
	const dd = String(m[3] ?? "");

	let fi = 0;
	let ci = 0;
	let out = "";
	while (fi < format.length) {
		if (format[fi] === "[") {
			const close = format.indexOf("]", fi + 1);
			if (close < 0) return null;
			const lit = format.slice(fi + 1, close);
			if (core.slice(ci, ci + lit.length) !== lit) return null;
			out += lit;
			ci += lit.length;
			fi = close + 1;
			continue;
		}

		const rest = format.slice(fi);
		if (rest.startsWith("YYYY")) {
			if (ci + 4 > core.length) return null;
			out += yyyy;
			ci += 4;
			fi += 4;
			continue;
		}
		if (rest.startsWith("YY")) {
			if (ci + 2 > core.length) return null;
			out += yy;
			ci += 2;
			fi += 2;
			continue;
		}
		if (rest.startsWith("MM")) {
			if (ci + 2 > core.length) return null;
			out += mm;
			ci += 2;
			fi += 2;
			continue;
		}
		if (rest.startsWith("DD")) {
			if (ci + 2 > core.length) return null;
			out += dd;
			ci += 2;
			fi += 2;
			continue;
		}

		const current = format[fi] ?? "";
		if (/[A-Za-z]/.test(current)) {
			let run = 1;
			while ((format[fi + run] ?? "") === current) run++;
			if (ci + run > core.length) return null;
			out += core.slice(ci, ci + run);
			ci += run;
			fi += run;
			continue;
		}

		const ch = current;
		if ((core[ci] ?? "") !== ch) return null;
		out += core[ci] ?? "";
		ci += 1;
		fi += 1;
	}

	if (ci !== core.length) return null;
	return out;
}

function buildDailyPath(folder: string, core: string, suffix: string): string {
	const relNoExt = `${String(core || "")}${String(suffix || "")}`;
	return normalizePath(folder ? `${folder}/${relNoExt}.md` : `${relNoExt}.md`);
}

function getNextAvailableVariantPath(app: AppLike, targetPathRaw: string, selfPathRaw: string): string {
	const targetPath = normalizePath(String(targetPathRaw || ""));
	const selfPath = normalizePath(String(selfPathRaw || ""));
	const targetExisting = app.vault.getAbstractFileByPath(targetPath);
	if (!(targetExisting instanceof TFile) || targetPath === selfPath) {
		return targetPath;
	}

	const noExt = targetPath.replace(/\.md$/i, "");
	const stem = noExt.replace(/ \(\d+\)$/i, "");
	for (let n = 1; n <= 500; n++) {
		const candidate = `${stem} (${n}).md`;
		const existing = app.vault.getAbstractFileByPath(candidate);
		if (!(existing instanceof TFile) || candidate === selfPath) {
			return candidate;
		}
	}
	return targetPath;
}

async function ensureParentFolders(app: AppLike, filePath: string): Promise<void> {
	const parent = normalizePath(String(filePath || ""))
		.split("/")
		.slice(0, -1)
		.join("/")
		.trim();
	if (!parent) return;
	const parts = parent.split("/").filter(Boolean);
	let acc = "";
	for (const part of parts) {
		acc = acc ? `${acc}/${part}` : part;
		const existing = app.vault.getAbstractFileByPath(acc);
		if (existing instanceof TFolder) continue;
		if (existing instanceof TFile) {
			throw new Error(`Cannot create folder; file exists at: ${acc}`);
		}
		await app.vault.createFolder(acc);
	}
}

function captureEntryRowSnapshot(canvas: EpochCanvas, entry: DateEntry): {
	img: HTMLCanvasElement;
	w: number;
	h: number;
	x1: number;
	y1: number;
} | null {
	try {
		const s = getAnchorDndState(canvas);
		if (!s.canvas || !s.ctx) return null;

		const pickRectFromList = (rects: SummaryRectLike[] | undefined): SummaryRectLike | null => {
			if (!Array.isArray(rects) || rects.length === 0) return null;
			let fallback: SummaryRectLike | null = null;
			for (const r of rects) {
				if (r?.entry === entry) {
					return r;
				}
				if (
					getEntryFile(r?.entry ?? null) === getEntryFile(entry) &&
					getEntryDate(r?.entry ?? null) === getEntryDate(entry) &&
					getEntryBlockStart(r?.entry ?? null) === getEntryBlockStart(entry) &&
					getEntryBlockEnd(r?.entry ?? null) === getEntryBlockEnd(entry)
				) {
					return r;
				}
				if (
					!fallback &&
					getEntryFile(r?.entry ?? null) === getEntryFile(entry) &&
					getEntryDate(r?.entry ?? null) === getEntryDate(entry) &&
					getEntrySource(r?.entry ?? null) === getEntrySource(entry)
				) {
					fallback = r;
				}
				if (!fallback && getEntryFile(r?.entry ?? null) === getEntryFile(entry) && getEntryDate(r?.entry ?? null) === getEntryDate(entry)) {
					fallback = r;
				}
			}
			return fallback;
		};

		let rect: SummaryRectLike | null = null;
		let usedHoverRects = false;
		for (const layout of s.layouts ?? []) {
			rect = pickRectFromList(layout?.summaryRects);
			if (rect) {
				usedHoverRects = false;
				break;
			}
			rect = pickRectFromList(layout?.summaryHoverRects);
			if (rect) {
				usedHoverRects = true;
				break;
			}
		}
		if (!rect) return null;
		const rect0 = rect;

		const canvasRect = s.canvas.getBoundingClientRect();
		const maxW = Math.max(0, canvasRect.width);
		const maxH = Math.max(0, canvasRect.height);
		if (!maxW || !maxH) return null;

		const tryBuild = (pad: number, innerPad: number) => {
			const x1 = Number(rect0.x1) + pad - innerPad;
			const y1 = Number(rect0.y1) + pad - innerPad;
			const x2 = Number(rect0.x2) - pad + innerPad;
			const y2 = Number(rect0.y2) - pad + innerPad;
			if (![x1, y1, x2, y2].every(Number.isFinite)) return null;

			const clippedX1 = Math.max(0, Math.min(maxW, x1));
			const clippedY1 = Math.max(0, Math.min(maxH, y1));
			const clippedX2 = Math.max(0, Math.min(maxW, x2));
			const clippedY2 = Math.max(0, Math.min(maxH, y2));
			const clippedWCss = Math.max(1, clippedX2 - clippedX1);
			const clippedHCss = Math.max(1, clippedY2 - clippedY1);
			if (clippedWCss <= 1 || clippedHCss <= 1) return null;
			return { clippedX1, clippedY1, clippedWCss, clippedHCss };
		};

		const padBase = usedHoverRects ? HOVER_HIT_PAD : TOUCH_HIT_PAD;
		const pad0 = Math.max(0, Number(padBase) || 0);
		const built = tryBuild(pad0, 1) ?? tryBuild(Math.min(2, pad0), 0) ?? tryBuild(0, 0);
		if (!built) return null;
		const { clippedX1, clippedY1, clippedWCss, clippedHCss } = built;

		const w = s.win ?? window;
		const dpr = (w && typeof w.devicePixelRatio === "number" ? w.devicePixelRatio : window.devicePixelRatio) || 1;
		const sx = Math.max(0, Math.floor(clippedX1 * dpr));
		const sy = Math.max(0, Math.floor(clippedY1 * dpr));
		const sw = Math.max(1, Math.floor(clippedWCss * dpr));
		const sh = Math.max(1, Math.floor(clippedHCss * dpr));
		if (!sw || !sh) return null;

		let imgData: ImageData | null = null;
		try {
			imgData = s.ctx.getImageData(sx, sy, sw, sh);
		} catch {
			imgData = null;
		}
		if (!imgData) return null;

		const doc = s.canvas?.ownerDocument ?? (typeof window !== "undefined" ? window.document : null);
		if (!doc) return null;
		const off = doc.createElement("canvas");
		off.width = sw;
		off.height = sh;
		const offCtx = off.getContext("2d");
		if (!offCtx) return null;
		try {
			offCtx.putImageData(imgData, 0, 0);
		} catch {
			return null;
		}

		return { img: off, w: clippedWCss, h: clippedHCss, x1: clippedX1, y1: clippedY1 };
	} catch {
		return null;
	}
}

function findDayIndexForLocalY(s: AnchorDndState, localY: number): number | null {
	const layouts: LayoutLike[] = Array.isArray(s.layouts) ? s.layouts : [];
	if (layouts.length === 0) return null;
	const half = (BASE_SPACING * (Number(s.scale) || 1)) / 2;
	let best: { index: number; dist: number } | null = null;
	for (const l of layouts) {
		if (!l || typeof l.index !== "number" || !Number.isFinite(Number(l.y))) continue;
		const y = Number(l.y);
		if (localY >= y - half && localY <= y + half) return l.index;
		const d = Math.abs(localY - y);
		if (!best || d < best.dist) best = { index: l.index, dist: d };
	}
	return best ? best.index : null;
}

function ensureAutoScrollLoop(canvas: EpochCanvas): void {
	const s = getAnchorDndState(canvas);
	if (s.entryDragAutoScrollRaf != null) return;
	s.entryDragAutoScrollLastAt = window.performance.now();

	const step = () => {
		if (!s.entryDragActive) {
			s.entryDragAutoScrollRaf = null;
			return;
		}
		// If the row snapshot wasn't available when the drag started (common immediately
		// after creating a daily note), keep retrying while drag is active so the ghost
		// appears as soon as the layout catches up, even if the pointer stops moving.
		try {
			if (!s.entryDragGhost && s.entryDragGhostSourceEntry) {
				const now = window.performance.now();
				const lastTry = Number(s.entryDragGhostAttemptedAt) || 0;
				if (now - lastTry > 140) {
					s.entryDragGhostAttemptedAt = now;
					const snap = captureEntryRowSnapshot(canvas, s.entryDragGhostSourceEntry);
					if (snap) {
						const localX = Number(s.entryDragLastLocalX) || 0;
						const localY = Number(s.entryDragLastLocalY) || 0;
						const offsetX = localX - snap.x1;
						const offsetY = localY - snap.y1;
						s.entryDragGhost = {
							img: snap.img,
							w: snap.w,
							h: snap.h,
							offsetX: Number.isFinite(offsetX) ? offsetX : 0,
							offsetY: Number.isFinite(offsetY) ? offsetY : 0,
							x: localX - (Number.isFinite(offsetX) ? offsetX : 0),
							y: localY - (Number.isFinite(offsetY) ? offsetY : 0)
						};
						s.draw();
					}
				}
			}
		} catch {
			// ignore
		}
		const now = window.performance.now();
		const dt = Math.max(0, Math.min(64, now - (Number(s.entryDragAutoScrollLastAt) || now)));
		s.entryDragAutoScrollLastAt = now;

		const rect = s.canvas.getBoundingClientRect();
		const h = rect.height;
		const y = Number(s.entryDragLastLocalY) || 0;
		const zone = 56;
		const maxSpeed = 22;
		let delta = 0;
		if (h > 0) {
			if (y < zone) {
				const t = Math.max(0, Math.min(1, 1 - y / zone));
				delta = +maxSpeed * t;
			} else if (y > h - zone) {
				const d = h - y;
				const t = Math.max(0, Math.min(1, 1 - d / zone));
				delta = -maxSpeed * t;
			}
		}
		if (delta !== 0) {
			s.offsetY += delta * (dt / 16.6667);
			s.draw();
		}
		s.entryDragAutoScrollRaf = window.requestAnimationFrame(step);
	};

	s.entryDragAutoScrollRaf = window.requestAnimationFrame(step);
}

export function beginAnchorEntryDrag(
	canvas: EpochCanvas,
	entry: DateEntry,
	source: DragSource,
	clientX: number,
	clientY: number,
	ghostEntry?: DateEntry | null
): void {
	const s = getAnchorDndState(canvas);
	s.entryDragActive = true;
	s.entryDragEntry = entry;
	s.entryDragSource = source;
	s.entryDragTargetDayIndex = null;
	s.entryDragLastClientX = clientX;
	s.entryDragLastClientY = clientY;
	s.entryDragGhost = null;
	s.entryDragGhostSourceEntry = ghostEntry ?? entry;
	s.entryDragGhostAttemptedAt = 0;
	try {
		const rect = s.canvas.getBoundingClientRect();
		s.entryDragLastLocalX = clientX - rect.left;
		s.entryDragLastLocalY = clientY - rect.top;
	} catch {
		s.entryDragLastLocalX = 0;
		s.entryDragLastLocalY = 0;
	}
	try {
		const snap = captureEntryRowSnapshot(canvas, ghostEntry ?? entry);
		if (snap) {
			const localX = Number(s.entryDragLastLocalX) || 0;
			const localY = Number(s.entryDragLastLocalY) || 0;
			const offsetX = localX - snap.x1;
			const offsetY = localY - snap.y1;
			s.entryDragGhost = {
				img: snap.img,
				w: snap.w,
				h: snap.h,
				offsetX: Number.isFinite(offsetX) ? offsetX : 0,
				offsetY: Number.isFinite(offsetY) ? offsetY : 0,
				x: localX - (Number.isFinite(offsetX) ? offsetX : 0),
				y: localY - (Number.isFinite(offsetY) ? offsetY : 0)
			};
		}
	} catch {
		// ignore
	}
	try {
		s.keepHoverUntilPointerMove = false;
		s.clearHover(true);
	} catch {
		// ignore
	}
	try {
		setCssStyles(s.canvas, { cursor: "grabbing" });
	} catch {
		// ignore
	}
	ensureAutoScrollLoop(canvas);
}

export function updateAnchorEntryDrag(canvas: EpochCanvas, clientX: number, clientY: number): void {
	const s = getAnchorDndState(canvas);
	if (!s.entryDragActive) return;
	s.entryDragLastClientX = clientX;
	s.entryDragLastClientY = clientY;
	const rect = s.canvas.getBoundingClientRect();
	const localX = clientX - rect.left;
	const localY = clientY - rect.top;
	s.entryDragLastLocalX = localX;
	s.entryDragLastLocalY = localY;
	const shouldTryGhostCaptureAfterDraw = !s.entryDragGhost && !!s.entryDragGhostSourceEntry;
	try {
		if (s.entryDragGhost) {
			s.entryDragGhost.x = localX - (Number(s.entryDragGhost.offsetX) || 0);
			s.entryDragGhost.y = localY - (Number(s.entryDragGhost.offsetY) || 0);
		}
	} catch {
		// ignore
	}

	const dayIndex = findDayIndexForLocalY(s, localY);
	if (dayIndex != null && dayIndex !== s.entryDragTargetDayIndex) {
		s.entryDragTargetDayIndex = dayIndex;
		try {
			s.hoverSummary = null;
			s.animSummary = null;
			s.hoverDateIndex = dayIndex;
			s.animDateIndex = dayIndex;
			s.hoverTarget = 1;
			s.requestHoverAnimation();
		} catch {
			// ignore
		}
	}

	s.draw();
	// If the ghost snapshot didn't exist yet (common when the entry was just created),
	// retry capturing it *after* a draw/layout pass, then redraw once so it appears
	// even if the pointer stops moving.
	try {
		if (shouldTryGhostCaptureAfterDraw && !s.entryDragGhost && s.entryDragGhostSourceEntry) {
			const now = window.performance.now();
			const lastTry = Number(s.entryDragGhostAttemptedAt) || 0;
			if (now - lastTry > 80) {
				s.entryDragGhostAttemptedAt = now;
				const snap = captureEntryRowSnapshot(canvas, s.entryDragGhostSourceEntry);
				if (snap) {
					const offsetX = localX - snap.x1;
					const offsetY = localY - snap.y1;
					s.entryDragGhost = {
						img: snap.img,
						w: snap.w,
						h: snap.h,
						offsetX: Number.isFinite(offsetX) ? offsetX : 0,
						offsetY: Number.isFinite(offsetY) ? offsetY : 0,
						x: localX - (Number.isFinite(offsetX) ? offsetX : 0),
						y: localY - (Number.isFinite(offsetY) ? offsetY : 0)
					};
					s.draw();
				}
			}
		}
	} catch {
		// ignore
	}
}

export function cancelAnchorEntryDrag(canvas: EpochCanvas): void {
	const s = getAnchorDndState(canvas);
	if (!s.entryDragActive) return;
	clearDragState(s);
	try {
		s.clearHover();
	} catch {
		// ignore
	}
	s.draw();
}

export async function commitAnchorEntryDrag(canvas: EpochCanvas): Promise<void> {
	const s = getAnchorDndState(canvas);
	if (!s.entryDragActive) return;
	const entry: DateEntry | null = s.entryDragEntry ?? null;
	const targetIndex: number | null = typeof s.entryDragTargetDayIndex === "number" ? s.entryDragTargetDayIndex : null;
	const lastClientX = Number(s.entryDragLastClientX) || 0;
	const lastClientY = Number(s.entryDragLastClientY) || 0;
	let droppedInsideCanvas = true;
	try {
		const rect = s.canvas.getBoundingClientRect();
		droppedInsideCanvas =
			lastClientX >= rect.left &&
			lastClientX <= rect.right &&
			lastClientY >= rect.top &&
			lastClientY <= rect.bottom;
	} catch {
		// If we can't compute bounds, default to current behavior.
		droppedInsideCanvas = true;
	}

	clearDragState(s);

	// Dropping outside the panel/canvas cancels the move.
	if (!droppedInsideCanvas) {
		try {
			s.clearHover();
		} catch {
			// ignore
		}
		s.draw();
		return;
	}

	if (!entry || targetIndex == null) {
		try {
			s.clearHover();
		} catch {
			// ignore
		}
		s.draw();
		return;
	}

	try {
		const today = s.getToday();
		const date = s.getDateForIndex(targetIndex, today);
		const dateKey = resolveDateKeyForCanvasDrop(date);
		const prevKey = getEntryDate(entry).trim();
		if (prevKey && prevKey === dateKey) {
			s.draw();
			return;
		}
		const plugin = s.plugin;
		let pathToUpdate = getEntryFile(entry);
		if (plugin && plugin.app && plugin.app.vault && typeof plugin.setYamlDateForPath === "function") {
			const app = plugin.app;
			const af = app.vault.getAbstractFileByPath(pathToUpdate);
			if (af instanceof TFile) {
				const info = getDailyNoteInfoForPath(plugin, af.path);
				if (info) {
					const rewrittenCore = rewriteDailyCoreDate(info.core, info.format, dateKey);
					let targetPath = rewrittenCore
						? buildDailyPath(info.folder, rewrittenCore, info.suffix)
						: af.path;
					targetPath = getNextAvailableVariantPath(app, targetPath, af.path);
					if (normalizePath(targetPath) !== normalizePath(af.path)) {
						await ensureParentFolders(app, targetPath);
						try {
							await app.vault.rename(af, targetPath);
						} catch {
							// Retry once in case a concurrent create/rename took the computed name.
							const retry = getNextAvailableVariantPath(app, targetPath, af.path);
							if (retry && normalizePath(retry) !== normalizePath(targetPath)) {
								await ensureParentFolders(app, retry);
								await app.vault.rename(af, retry);
								targetPath = retry;
							}
						}
					}
					pathToUpdate = targetPath;
				} else if (getEntrySource(entry) === "namedate") {
					const isMd = String(af.path || "").toLowerCase().endsWith(".md");
					if (isMd) {
						const dates = parseAnyDates(String(af.basename || ""));
						if (dates.length >= 1) {
							const anchorKey = (/^\d{4}-\d{2}-\d{2}$/.test(prevKey) ? prevKey : String(dates[0] ?? "").trim());
							const pickReplacement = (raw: string): { index: number; len: number; replacement: string } | null => {
								const s0 = String(raw ?? "");
								const [yy, mm, dd] = dateKey.split("-");
								const newParts = { yy: String(yy ?? ""), mm: String(mm ?? ""), dd: String(dd ?? "") };
								let best: { index: number; len: number; replacement: string } | null = null;
								const consider = (index: number, token: string, replacement: string) => {
									if (index < 0) return;
									const parsed = parseAnyDate(token);
									if (!parsed || parsed !== anchorKey) return;
									const cand = { index, len: token.length, replacement };
									if (!best || cand.index < best.index) best = cand;
								};

								const yearFirst = /\b(\d{4})([.\-/])(\d{1,2})\2(\d{1,2})\b/g;
								for (const m of s0.matchAll(yearFirst)) {
									const token = String(m[0] ?? "");
									const delim = String(m[2] ?? "-");
									const monthRaw = String(m[3] ?? "");
									const dayRaw = String(m[4] ?? "");
									const monthOut = monthRaw.length === 1 ? String(Number(newParts.mm)) : newParts.mm;
									const dayOut = dayRaw.length === 1 ? String(Number(newParts.dd)) : newParts.dd;
									consider(Number(m.index ?? -1), token, `${newParts.yy}${delim}${monthOut}${delim}${dayOut}`);
								}

								const dayFirst = /\b(\d{1,2})([.\-/])(\d{1,2})\2(\d{4})\b/g;
								for (const m of s0.matchAll(dayFirst)) {
									const token = String(m[0] ?? "");
									const delim = String(m[2] ?? "-");
									const dayRaw = String(m[1] ?? "");
									const monthRaw = String(m[3] ?? "");
									const dayOut = dayRaw.length === 1 ? String(Number(newParts.dd)) : newParts.dd;
									const monthOut = monthRaw.length === 1 ? String(Number(newParts.mm)) : newParts.mm;
									consider(Number(m.index ?? -1), token, `${dayOut}${delim}${monthOut}${delim}${newParts.yy}`);
								}

								return best;
							};

							const match = pickReplacement(String(af.basename || ""));
							if (match) {
								const nextBase =
									String(af.basename || "").slice(0, match.index) +
									match.replacement +
									String(af.basename || "").slice(match.index + match.len);
								const folder = normalizePath(String(af.path || "")).split("/").slice(0, -1).join("/");
								const ext = af.extension ? `.${String(af.extension)}` : "";
								const baseTarget = normalizePath(folder ? `${folder}/${nextBase}${ext}` : `${nextBase}${ext}`);
								const pickUniqueTarget = (rawPath: string): string | null => {
									const normalized = normalizePath(String(rawPath || ""));
									if (!app.vault.getAbstractFileByPath(normalized)) return normalized;
									const dot = normalized.lastIndexOf(".");
									const name = dot >= 0 ? normalized.slice(0, dot) : normalized;
									const ext = dot >= 0 ? normalized.slice(dot) : "";
									for (let i = 2; i <= 50; i++) {
										const cand = `${name} (${i})${ext}`;
										if (!app.vault.getAbstractFileByPath(cand)) return cand;
									}
									return null;
								};

								const targetPath = pickUniqueTarget(baseTarget);
								if (targetPath && normalizePath(targetPath) !== normalizePath(af.path)) {
									await app.vault.rename(af, targetPath);
									pathToUpdate = targetPath;
								}
							}
						}
					}
				}
			}
			await plugin.setYamlDateForPath(pathToUpdate, dateKey);
		}
	} catch {
		// ignore
	}

	try {
		s.clearHover();
	} catch {
		// ignore
	}
	s.draw();
}
