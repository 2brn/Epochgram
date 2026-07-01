import type { DateEntry } from "../../../indexer/types";
import type { EpochCanvas } from "../../epoch-canvas";
import {
	BASE_SPACING,
	EPOCH_BUCKET_TRANSITION_MS,
	SUMMARY_MIN_WIDTH,
	SUMMARY_OFFSET_X,
	SUMMARY_RIGHT_MARGIN,
	TIMELINE_X
} from "../../epoch-canvas-constants";
import type { EpochBucketName } from "../../epoch-canvas-constants";
import { getTodayOffset } from "../../epoch-canvas/metrics";
import type { CanvasDrawState } from "../state";
import { measureEpochsDaySummariesHeight } from "../../summary-rendering/epochs";
import type { PackedBlock } from "./packing-shared";
import { packVerticalBlocks } from "./packing-shared";

export function computePackedEpochDayCenterY(params: {
	canvas: EpochCanvas;
	s: CanvasDrawState;
	w: number;
	frameNow: number;
	epochBucket: EpochBucketName | null;
	minIndex: number;
	maxIndex: number;
	renderIndices?: number[];
	entriesByIndex: Map<number, DateEntry[]>;
	prevEntriesByIndex: Map<number, DateEntry[]>;
	prevEpochBucket: EpochBucketName | null;
	bucketFadeT: number;
	rowHeight: number;
	hoverGap: number;
	ctx: CanvasRenderingContext2D;
	activePath: string | null;
	fontSmall: string;
	fontSmallHover: string;
	fontEpochLine1?: string;
	fontEpochLine1Hover?: string;
	colTextBase: string;
	colTextHover: string;
	colHighlight: string;
	colRelated: string;
	markColors: string[];
	inheritedMarkIndexByPath: Map<string, number> | null;
}): Map<number, number> {
	const {
		canvas,
		s,
		w,
		frameNow,
		epochBucket,
		minIndex,
		maxIndex,
		renderIndices,
		entriesByIndex,
		prevEpochBucket,
		bucketFadeT,
		rowHeight,
		hoverGap,
		ctx,
		activePath,
		fontSmall,
		fontSmallHover,
		fontEpochLine1,
		fontEpochLine1Hover,
		colTextBase,
		colTextHover,
		colHighlight,
		colRelated,
		markColors,
		inheritedMarkIndexByPath
	} = params;

	const packedEpochDayCenterY = new Map<number, number>();
	const rightWidth = w - (TIMELINE_X + SUMMARY_OFFSET_X) - SUMMARY_RIGHT_MARGIN;
	if (rightWidth <= SUMMARY_MIN_WIDTH) return packedEpochDayCenterY;

	// Packing stability goal:
	// - Panning/scrolling changes minIndex/maxIndex, which changes the visible set.
	// - If we pack only visible blocks, blocks entering/leaving the viewport can cause the
	//   remaining blocks to re-pack, which looks like "jumping" while panning.
	// - To avoid this, keep a persistent set of packed blocks (with cached measured heights)
	//   and include that cached set in packing, so the packing solution is stable across pan.
	// Cache is invalidated when layout-affecting inputs change (bucket/scale/width/search/etc).
	const searchQuery = String(s.searchQuery || "");
	const packSig = (() => {
		const b = epochBucket ? String(epochBucket) : "__any__";
		const rw = Math.round(rightWidth);
		const sc = Math.round((Number(s.scale) || 0) * 1e6);
		const rh = Math.round((Number(rowHeight) || 0) * 1e3);
		const hg = Math.round((Number(hoverGap) || 0) * 1e3);
		const sh = s.showHidden ? 1 : 0;
		return `${b}|${rw}|${sc}|${rh}|${hg}|${sh}|${searchQuery}`;
	})();
	const prevPackSig = String(s.__epochPackSig || "");
	if (prevPackSig !== packSig) {
		s.__epochPackSig = packSig;
		s.epochPackCenterCache = new Map();
		s.epochPackAlphaByIndex = new Map();
		s.__epochPackInstantAppearOnce = true;
		s.__epochPackBaselineShift = 0;
		s.__epochPackBaselineShiftTarget = 0;
		s.__epochPackBaselineShiftMoveUntil = Number.NaN;
		s.__epochPackBaselineShiftLastAt = frameNow;
		s.__epochPackBaselineAnchorIndex = null;
		s.__epochPackBaselineAnchorLockUntil = Number.NaN;
	}

	const xStart = TIMELINE_X + SUMMARY_OFFSET_X;
	const blocks: PackedBlock[] = [];
	const prevAnimSummary: { dayIndex: number; itemIndex: number } | null = s.prevAnimSummary ?? null;
	const outgoingSummaries: Array<{ dayIndex: number; itemIndex: number; t: number }> | null =
		s.outgoingSummaries ?? null;

	if (!(s.epochPackCenterCache instanceof Map)) {
		s.epochPackCenterCache = new Map();
	}
	type PackCacheState = { offset: number; lastAt: number; appearAt: number; moveUntil?: number; height?: number };
	const cache: Map<number, PackCacheState> = s.epochPackCenterCache;

	// Seed blocks with cached (offscreen) blocks so the packed solution stays stable while panning.
	// Only include cached blocks that have a measured height.
	for (const [i, st] of cache.entries()) {
		const height = Number(st.height) || 0;
		if (!(height > 0)) continue;
		const worldY = i * BASE_SPACING;
		const yScreen = worldY * s.scale + s.offsetY;
		blocks.push({
			i,
			height,
			centerY: yScreen,
			top: yScreen - height / 2,
			bottom: yScreen + height / 2
		});
	}

	const indices = Array.isArray(renderIndices) && renderIndices.length ? renderIndices : null;
	const it = indices ? indices : null;
	if (it) {
		for (let idx = 0; idx < it.length; idx++) {
			const i = it[idx];
			if (typeof i !== "number") continue;
			if (i < minIndex || i > maxIndex) continue;
			const worldY = i * BASE_SPACING;
			const yScreen = worldY * s.scale + s.offsetY;

			const entries = entriesByIndex.get(i) ?? [];
			const currentHeight = entries.length
				? measureEpochsDaySummariesHeight({
						ctx,
						entries,
						dayIndex: i,
						dayCenterY: yScreen,
						xStart,
						rightWidth,
						rowHeight,
						hoverAnim: s.hoverAnim,
						hoverGap,
						animSummary: s.animSummary,
						prevAnimSummary,
						outgoingSummaries,
						activeFilePath: activePath,
						showHidden: s.showHidden,
						fontSmall,
						fontSmallHover,
						fontEpochLine1,
						fontEpochLine1Hover,
						colTextBase,
						colTextHover,
						colHighlight,
						colRelated,
						markColors,
						inheritedMarkIndexByPath
				  })
				: 0;

			const height = currentHeight;
			if (height > 0) {
				const st = cache.get(i);
				if (st) st.height = height;
				blocks.push({
					i,
					height,
					centerY: yScreen,
					top: yScreen - height / 2,
					bottom: yScreen + height / 2
				});
			}
		}
	} else {
		for (let i = minIndex; i <= maxIndex; i++) {
		const worldY = i * BASE_SPACING;
		const yScreen = worldY * s.scale + s.offsetY;

		const entries = entriesByIndex.get(i) ?? [];
		const currentHeight = entries.length
			? measureEpochsDaySummariesHeight({
					ctx,
					entries,
					dayIndex: i,
					dayCenterY: yScreen,
					xStart,
					rightWidth,
					rowHeight,
					hoverAnim: s.hoverAnim,
					hoverGap,
					animSummary: s.animSummary,
					prevAnimSummary,
					outgoingSummaries,
					activeFilePath: activePath,
					showHidden: s.showHidden,
					fontSmall,
					fontSmallHover,
					fontEpochLine1,
					fontEpochLine1Hover,
					colTextBase,
					colTextHover,
					colHighlight,
					colRelated,
					markColors,
					inheritedMarkIndexByPath
			  })
			: 0;

		// Packing should reflect the *final* layout (current bucket) so fade-out entries
		// don't re-stack everything and cause jumps.
		const height = currentHeight;
		if (height > 0) {
			const st = cache.get(i);
			if (st) st.height = height;
			blocks.push({
				i,
				height,
				centerY: yScreen,
				top: yScreen - height / 2,
				bottom: yScreen + height / 2
			});
		}
		}
	}

	// De-dupe blocks by index (cached + current range can overlap).
	if (blocks.length > 1) {
		const byIndex = new Map<number, PackedBlock>();
		for (const b of blocks) byIndex.set(b.i, b);
		blocks.length = 0;
		for (const b of byIndex.values()) blocks.push(b);
	}
	blocks.sort((a, b) => a.i - b.i);

	// Pack gap: keep stacked epoch blocks as tight as in-row stacking.
	const packGap = 0;
	packVerticalBlocks(blocks, packGap);

	const now = frameNow;
	if (!(s.epochPackAlphaByIndex instanceof Map)) {
		s.epochPackAlphaByIndex = new Map();
	}
	const alphaByIndex: Map<number, number> = s.epochPackAlphaByIndex;
	const instantAppearOnce = s.__epochPackInstantAppearOnce === true;
	const visible = new Set<number>();
	const animMs = Math.max(1, Math.min(800, Number(EPOCH_BUCKET_TRANSITION_MS) || 320));
	const baselineAnimMs = Math.max(80, Math.min(420, Math.round(animMs * 0.7)));

	if (typeof s.__epochPackBaselineShift !== "number" || !Number.isFinite(Number(s.__epochPackBaselineShift))) {
		s.__epochPackBaselineShift = 0;
	}
	if (typeof s.__epochPackBaselineShiftTarget !== "number" || !Number.isFinite(Number(s.__epochPackBaselineShiftTarget))) {
		s.__epochPackBaselineShiftTarget = Number(s.__epochPackBaselineShift) || 0;
	}
	let baselineShift = Number(s.__epochPackBaselineShift) || 0;
	let baselineShiftTarget = Number(s.__epochPackBaselineShiftTarget) || baselineShift;
	const prevMoveUntil0 = Number(s.__epochPackBaselineShiftMoveUntil);
	const wasMoving0 = Number.isFinite(prevMoveUntil0) && now < prevMoveUntil0;
	const lockUntil0 = Number(s.__epochPackBaselineAnchorLockUntil);
	const anchorLocked = wasMoving0 || (Number.isFinite(lockUntil0) && now < lockUntil0);

	try {
		const baselineY = getTodayOffset(canvas);
		const viewportH = (() => {
			try {
				const rect = s.root?.getBoundingClientRect?.();
				const hh = Number(rect?.height);
				if (Number.isFinite(hh) && hh > 0) return hh;
			} catch {
				// ignore
			}
			try {
				const dpr = (window && typeof window.devicePixelRatio === "number") ? window.devicePixelRatio : 1;
				const ch = Number(s.canvas?.height);
				if (Number.isFinite(ch) && ch > 0 && dpr > 0) return ch / dpr;
			} catch {
				// ignore
			}
			return Number.NaN;
		})();

		if (Number.isFinite(baselineY) && blocks.length > 0) {
			const findBlockByIndex = (index: number): PackedBlock | null => {
				for (const b of blocks) if (b.i === index) return b;
				return null;
			};

			let best: PackedBlock | null = null;
			let bestDist = Number.POSITIVE_INFINITY;
			const lockedIndexRaw = s.__epochPackBaselineAnchorIndex;
			const lockedIndex = (typeof lockedIndexRaw === "number" && Number.isFinite(lockedIndexRaw)) ? lockedIndexRaw : null;
			if (anchorLocked && lockedIndex != null) {
				best = findBlockByIndex(lockedIndex);
				if (best) {
					const packedY = (best.top + best.bottom) / 2;
					const packedYShifted = packedY - baselineShift;
					bestDist = Math.abs(packedYShifted - baselineY);
				}
			}
			if (!best) {
				for (const b of blocks) {
					const packedY = (b.top + b.bottom) / 2;
					const packedYShifted = packedY - baselineShift;
					const dist = Math.abs(packedYShifted - baselineY);
					if (best == null || dist < bestDist) {
						best = b;
						bestDist = dist;
					}
				}
				if (best) {
					s.__epochPackBaselineAnchorIndex = best.i;
				}
			}
			const maxNearDist = Math.max(BASE_SPACING * s.scale, rowHeight * 6, 120);
			if (best && Number.isFinite(best.centerY) && Number.isFinite(viewportH) && viewportH > 0 && bestDist <= maxNearDist) {
				const packedY = (best.top + best.bottom) / 2;
				const packedYShifted = packedY - baselineShift;
				const driftNow = packedYShifted - best.centerY;
				const targetOffscreen = best.centerY < 0 || best.centerY > viewportH;
				// Avoid retargeting while the baseline shift is already moving; that can cause
				// oscillation if the "closest" block flips between neighbors mid-animation.
				if (!wasMoving0 && targetOffscreen && Number.isFinite(driftNow) && Math.abs(driftNow) > 0.5) {
					baselineShiftTarget = baselineShift + driftNow;
				}
			}
		}
	} catch {
		// ignore
	}

	let baselineNeedsAnimation = false;
	const prevBaselineTarget = Number(s.__epochPackBaselineShiftTarget) || baselineShift;
	if (Number.isFinite(baselineShiftTarget) && Math.abs(baselineShiftTarget - prevBaselineTarget) > 0.5) {
		s.__epochPackBaselineShiftTarget = baselineShiftTarget;
		s.__epochPackBaselineShiftMoveUntil = now + baselineAnimMs;
		s.__epochPackBaselineShiftLastAt = now;
		s.__epochPackBaselineAnchorLockUntil = now + baselineAnimMs + 140;
		baselineNeedsAnimation = true;
	} else {
		baselineShiftTarget = prevBaselineTarget;
	}
	const moveUntil = Number(s.__epochPackBaselineShiftMoveUntil);
	const moving = Number.isFinite(moveUntil) && now < moveUntil;
	if (moving) {
		const prevAt = Number(s.__epochPackBaselineShiftLastAt) || now;
		const dt = Math.max(0, now - prevAt);
		const remaining = Math.max(1, moveUntil - prevAt);
		const t = Math.max(0, Math.min(1, dt / remaining));
		baselineShift = baselineShift + (baselineShiftTarget - baselineShift) * t;
		s.__epochPackBaselineShift = baselineShift;
		s.__epochPackBaselineShiftLastAt = now;
		baselineNeedsAnimation = true;
	} else {
		baselineShift = baselineShiftTarget;
		s.__epochPackBaselineShift = baselineShift;
	}

	const lastScale = Number(s.epochPackLastScale);
	const scaleChanged = !Number.isFinite(lastScale) || Math.abs(lastScale - s.scale) > 1e-6;
	const hasNewBlocks = (() => {
		for (const b of blocks) {
			if (!cache.has(b.i)) return true;
		}
		return false;
	})();
	// No moving at all: always apply final packed layout immediately.
	const bucketAnimating = !!prevEpochBucket && bucketFadeT < 1;
	const instantLayout = true;

	if (scaleChanged && !instantLayout) {
		s.epochPackZoomUntil = now + animMs;
	}
	const wasBucketAnimating = s.epochPackBucketAnimating === true;
	if (!instantLayout && bucketAnimating && !wasBucketAnimating) {
		s.epochPackZoomUntil = now + animMs;
	}
	if (!instantLayout && hasNewBlocks) {
		s.epochPackZoomUntil = now + animMs;
	}
	s.epochPackBucketAnimating = bucketAnimating;
	s.epochPackLastScale = s.scale;
	const zoomUntil = instantLayout ? Number.NaN : Number(s.epochPackZoomUntil);
	const zoomAnimating = !instantLayout && Number.isFinite(zoomUntil) && now < zoomUntil;
	let needsAnimation = zoomAnimating;
	if (baselineNeedsAnimation) needsAnimation = true;

	for (const b of blocks) {
		visible.add(b.i);
		const desiredY = (b.top + b.bottom) / 2;
		const desiredOffset = desiredY - b.centerY;
		let st = cache.get(b.i);
		if (!st) {
			// New block: appear only after zoom/bucket transitions settle, so it doesn't visibly move.
			let appearAt = now;
			if (instantAppearOnce) {
				appearAt = now - animMs;
			}
			if (Number.isFinite(zoomUntil) && now < zoomUntil) {
				appearAt = Math.max(appearAt, zoomUntil);
			}
			if (bucketAnimating && bucketFadeT < 1) {
				appearAt = Math.max(appearAt, now + animMs * Math.max(0, 1 - bucketFadeT));
			}
			st = { offset: desiredOffset, lastAt: now, appearAt, height: b.height };
			cache.set(b.i, st);
		} else {
			st.height = b.height;
		}

		// During zoom/bucket transitions, don't animate offsets; just apply the packed target.
		if (instantLayout) {
			st.offset = desiredOffset;
			st.lastAt = now;
			st.moveUntil = undefined;
			// Keep fade behavior (appearAt/alpha) intact.
			const appearAt2 = Number(st.appearAt) || now;
			if (now < appearAt2) {
				alphaByIndex.set(b.i, 0);
				needsAnimation = true;
				packedEpochDayCenterY.set(b.i, b.centerY + st.offset - baselineShift);
				continue;
			}
			const appearT2 = Math.max(0, Math.min(1, (now - appearAt2) / animMs));
			if (appearT2 < 0.999) needsAnimation = true;
			alphaByIndex.set(b.i, appearT2);
			packedEpochDayCenterY.set(b.i, b.centerY + st.offset - baselineShift);
			continue;
		}
		const appearAt = Number(st.appearAt) || now;
		if (now < appearAt) {
			// Keep it positioned correctly but fully hidden until its appearAt.
			alphaByIndex.set(b.i, 0);
			st.offset = desiredOffset;
			st.lastAt = now;
			needsAnimation = true;
			packedEpochDayCenterY.set(b.i, b.centerY + st.offset - baselineShift);
			continue;
		}
		const appearT = Math.max(0, Math.min(1, (now - appearAt) / animMs));
		if (appearT < 0.999) needsAnimation = true;
		alphaByIndex.set(b.i, appearT);
		const appearUntil = appearAt + animMs;
		const maxUntil = (...values: number[]): number => {
			let out = -Infinity;
			for (const v of values) {
				if (Number.isFinite(v) && v > out) out = v;
			}
			return out;
		};
		let moveUntil = Number(st.moveUntil) || -Infinity;
		let animUntil = maxUntil(zoomUntil, appearUntil, moveUntil);
		let animating = Number.isFinite(animUntil) && now < animUntil;

		// If packing target changed (e.g., blocks entered/left viewport), start a fresh move animation
		// so we don't snap when re-positioning back to date-aligned locations.
		const diff = desiredOffset - st.offset;
		if (!animating && Math.abs(diff) > 0.75) {
			st.moveUntil = now + animMs;
			st.lastAt = now;
			moveUntil = st.moveUntil;
			animUntil = maxUntil(zoomUntil, appearUntil, moveUntil);
			animating = true;
			needsAnimation = true;
		}
		if (animating) {
			const prevAt = Number(st.lastAt) || now;
			const dt = Math.max(0, now - prevAt);
			// Interpolate based on remaining time so we arrive exactly at animUntil.
			const remaining = Math.max(1, animUntil - prevAt);
			const t = Math.max(0, Math.min(1, dt / remaining));
			st.offset = st.offset + (desiredOffset - st.offset) * t;
			st.lastAt = now;
			if (Math.abs(desiredOffset - st.offset) > 0.5) {
				s.packAnimating = true;
			}
			needsAnimation = true;
		} else {
			st.offset = desiredOffset;
			st.lastAt = now;
		}
		packedEpochDayCenterY.set(b.i, b.centerY + st.offset - baselineShift);
	}
	if (instantAppearOnce) {
		s.__epochPackInstantAppearOnce = false;
	}
	if (cache.size > 2000) {
		// Prune far-away cached blocks so the stable packing set doesn't grow without bound.
		// Use a generous padding so panning doesn't immediately drop blocks and reintroduce jumps.
		const pad = 2000;
		const minKeep = minIndex - pad;
		const maxKeep = maxIndex + pad;
		for (const k of cache.keys()) {
			if (k < minKeep || k > maxKeep) cache.delete(k);
		}
	}
	if (alphaByIndex.size > 2000) {
		const pad = 2000;
		const minKeep = minIndex - pad;
		const maxKeep = maxIndex + pad;
		for (const k of alphaByIndex.keys()) {
			if (k < minKeep || k > maxKeep) alphaByIndex.delete(k);
		}
	}
	if (s.packAnimating || needsAnimation) {
		s.requestHoverAnimation?.();
	}

	return packedEpochDayCenterY;
}
