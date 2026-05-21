import type { EpochCanvas } from "./epoch-canvas";
import {
	HOVER_ANIM_TIME_MS,
	INERTIA_DECAY,
	INERTIA_BOOST,
	INERTIA_MIN_VELOCITY,
	SUMMARY_MIN_SCALE
} from "./epoch-canvas-constants";
import { clampTimelineOffsetToBounds, resolveViewportHeight } from "./epoch-canvas/viewport-limits";

const DENSE_INSTANT_HOVER_SCALE_THRESHOLD = 0.85;

interface CanvasAnimateState {
	animFrame: number | null;
	hoverTarget: number;
	hoverAnim: number;
	hoverEaseStartAt: number | null;
	hoverEaseFrom: number;
	hoverEaseTo: number;
	animDateIndex: number | null;
	animSummary: { dayIndex: number; itemIndex: number } | null;
	outgoingSummaries?: Array<{ dayIndex: number; itemIndex: number; t: number }> | null;
	outgoingDates?: Array<{ index: number; t: number }> | null;
	velocityY: number;
	offsetY: number;
	scale: number;
	targetScale: number;
	targetOffsetY: number;
	animatingView: boolean;
	lastFrameTime: number | null;
	pinFly: {
		img: HTMLCanvasElement;
		fromX: number;
		fromY: number;
		toX: number;
		toY: number;
		w: number;
		h: number;
		startAt: number;
		durationMs: number;
		t: number;
	} | null;
	pinFlyOnDone: (() => void) | null;
	requestHoverAnimation(): void;
	draw(): void;
}

function state(canvas: EpochCanvas): CanvasAnimateState {
	return canvas as unknown as CanvasAnimateState;
}

function clamp01(n: number): number {
	if (!Number.isFinite(n)) return 0;
	return Math.max(0, Math.min(1, n));
}

// Evaluate CSS cubic-bezier easing by solving x(t)=p then returning y(t)
function cubicBezierEase(p: number, x1: number, y1: number, x2: number, y2: number): number {
	const u = clamp01(p);
	// Fast paths
	if (u === 0 || u === 1) return u;

	const ax = 3 * x1 - 3 * x2 + 1;
	const bx = -6 * x1 + 3 * x2;
	const cx = 3 * x1;
	const ay = 3 * y1 - 3 * y2 + 1;
	const by = -6 * y1 + 3 * y2;
	const cy = 3 * y1;

	const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
	const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
	const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;

	// Newton-Raphson iterations
	let t = u;
	for (let i = 0; i < 8; i++) {
		const x = sampleX(t) - u;
		const d = sampleDX(t);
		if (Math.abs(x) < 1e-6) break;
		if (Math.abs(d) < 1e-6) break;
		t -= x / d;
		if (t <= 0 || t >= 1) {
			t = clamp01(t);
			break;
		}
	}

	// Fallback to bisection if Newton didn't converge well
	let xErr = Math.abs(sampleX(t) - u);
	if (!(xErr < 1e-4)) {
		let lo = 0;
		let hi = 1;
		t = u;
		for (let i = 0; i < 20; i++) {
			const x = sampleX(t);
			if (Math.abs(x - u) < 1e-6) break;
			if (x < u) lo = t;
			else hi = t;
			t = (lo + hi) / 2;
		}
	}

	return clamp01(sampleY(t));
}

const WHEEL_PAN_SPEED_PX_PER_MS = 2.0;
// Constant-rate ctrl/meta wheel zoom speed, in natural-log(scale) per ms.
// This yields a perceptually consistent zoom speed across scales.
const WHEEL_ZOOM_LOG_SPEED_PER_MS = 0.0025;

export function runCanvasAnimation(canvas: EpochCanvas): void {
	const s = state(canvas);
	s.animFrame = null;

	const inertia = (() => {
		try {
			const pluginAny: any = (canvas as any)?.plugin;
			const settingsAny: any = pluginAny?.settings;
			const decayRaw = Number(settingsAny?.inertiaDecay);
			const boostRaw = Number(settingsAny?.inertiaBoost);
			const minVelRaw = Number(settingsAny?.inertiaMinVelocity);
			const decay = Number.isFinite(decayRaw) && decayRaw > 0 && decayRaw < 1 ? decayRaw : INERTIA_DECAY;
			const boost = Number.isFinite(boostRaw) && boostRaw > 0 ? boostRaw : INERTIA_BOOST;
			const minVel = Number.isFinite(minVelRaw) && minVelRaw >= 0 ? minVelRaw : INERTIA_MIN_VELOCITY;
			return { decay, boost, minVel };
		} catch {
			return { decay: INERTIA_DECAY, boost: INERTIA_BOOST, minVel: INERTIA_MIN_VELOCITY };
		}
	})();

	const animationsEnabled = (() => {
		try {
			const pluginAny: any = (canvas as any)?.plugin;
			return pluginAny?.settings?.enableAnimation !== false;
		} catch {
			return true;
		}
	})();
	if (!animationsEnabled) {
		// Snap all animation-driven state to its target and render once.
		s.hoverAnim = s.hoverTarget;
		s.hoverEaseStartAt = null;
		s.hoverEaseFrom = s.hoverTarget;
		s.hoverEaseTo = s.hoverTarget;
		(s as any).outgoingSummaries = [];
		(s as any).outgoingDates = [];
		(s as any).prevAnimSummary = null;
		(s as any).prevAnimDateIndex = null;
		if (s.hoverTarget === 0) {
			s.animDateIndex = null;
			s.animSummary = null;
			(s as any).hoverSummary = null;
			(s as any).hoverDateIndex = null;
		}

		s.velocityY = 0;
		if ((s as any).animatingWheelZoom) {
			const targetScale = Number.isFinite(s.targetScale) ? s.targetScale : s.scale;
			s.scale = targetScale;
			try {
				const anchorY = Number((s as any).wheelZoomAnchorY);
				const worldY = Number((s as any).wheelZoomAnchorWorldY);
				if (Number.isFinite(anchorY) && Number.isFinite(worldY) && targetScale > 0) {
					s.offsetY = anchorY - worldY * targetScale;
				} else {
					s.offsetY = s.targetOffsetY;
				}
			} catch {
				s.offsetY = s.targetOffsetY;
			}
			(s as any).animatingWheelZoom = false;
			(s as any).wheelZoomDir = 0;
		}
		if (s.animatingView) {
			s.scale = s.targetScale;
			s.offsetY = s.targetOffsetY;
			s.animatingView = false;
		}
		if ((s as any).animatingWheelPan) {
			s.offsetY = Number.isFinite(s.targetOffsetY) ? s.targetOffsetY : s.offsetY;
			(s as any).animatingWheelPan = false;
		}
		if (s.pinFly) {
			const done = s.pinFlyOnDone;
			s.pinFly = null;
			s.pinFlyOnDone = null;
			if (done) {
				try {
					done();
				} catch {
					// ignore
				}
			}
		}

		s.lastFrameTime = null;
		s.draw();
		return;
	}

	const now = performance.now();
	let dt = 0;
	const lastFrameTime = s.lastFrameTime;
	if (lastFrameTime != null) {
		dt = now - lastFrameTime;
	}
	s.lastFrameTime = now;

	const target = s.hoverTarget;
	const epochsViewActive = ((s as any).epochsView === true);
	const globalDenseMode: boolean | null = (() => {
		const v = (s as any).__globalDenseMode;
		return typeof v === "boolean" ? v : null;
	})();
	// Prefer the actual dense-mode decision from the renderer; fallback to a scale heuristic
	// only before the first draw has populated __globalDenseMode.
	//
	// IMPORTANT: date markers (circles/labels) should still use smooth hover animation even
	// when we're zoomed out into dense mode. Instant hover is only used to avoid expensive
	// summary reflow/overlay animation.
	const outgoingDates = (s as any).outgoingDates as Array<{ index: number; t: number }> | null | undefined;
	const hasDateHoverOrOutgoing = (s.animDateIndex != null) || (Array.isArray(outgoingDates) && outgoingDates.length > 0);
	const outgoingSummaries = (s as any).outgoingSummaries as Array<{ dayIndex: number; itemIndex: number; t: number }> | null | undefined;
	const hasSummaryHoverOrOutgoing = (s.animSummary != null) || (Array.isArray(outgoingSummaries) && outgoingSummaries.length > 0);
	const instantHover = !epochsViewActive && !hasDateHoverOrOutgoing && hasSummaryHoverOrOutgoing && (
		globalDenseMode === true ||
		(Number.isFinite(s.scale) && s.scale < SUMMARY_MIN_SCALE) ||
		(globalDenseMode == null && Number.isFinite(s.scale) && s.scale <= DENSE_INSTANT_HOVER_SCALE_THRESHOLD)
	);
	if (instantHover) {
		s.hoverAnim = target;
		s.hoverEaseStartAt = null;
		s.hoverEaseFrom = target;
		s.hoverEaseTo = target;
		if (target === 0) {
			// When hover is fully cleared, keep queued hover-out animations.
			// Instant-hover mode only snaps the incoming hover; outgoing fades still
			// matter to avoid visible snap-offs during brief pointer gaps.
			s.animDateIndex = null;
			s.animSummary = null;
			(s as any).prevAnimSummary = null;
			(s as any).prevAnimDateIndex = null;
			(s as any).hoverSummary = null;
			(s as any).hoverDateIndex = null;
		}
	}

	if (!instantHover) {
		if (s.hoverEaseStartAt === undefined) s.hoverEaseStartAt = null;
		if (!Number.isFinite(s.hoverEaseFrom)) s.hoverEaseFrom = s.hoverAnim || 0;
		if (!Number.isFinite(s.hoverEaseTo)) s.hoverEaseTo = target;

		// Restart ease when the target flips (hover in/out)
		if (s.hoverEaseTo !== target || s.hoverEaseStartAt == null) {
			s.hoverEaseFrom = Number.isFinite(s.hoverAnim) ? s.hoverAnim : 0;
			s.hoverEaseTo = target;
			s.hoverEaseStartAt = now;
		}

		const dur = Math.max(1, Number(HOVER_ANIM_TIME_MS) || 1);
		const hoverLinear = clamp01((now - Number(s.hoverEaseStartAt)) / dur);
		// Use a symmetric curve so hover-in and hover-out feel equally paced.
		const hoverEased = cubicBezierEase(hoverLinear, 0.42, 0, 0.58, 1);
		s.hoverAnim = s.hoverEaseFrom + (s.hoverEaseTo - s.hoverEaseFrom) * hoverEased;

		if (hoverLinear >= 1 || Math.abs(target - s.hoverAnim) < 0.01) {
			s.hoverAnim = target;
			s.hoverEaseStartAt = null;
			if (target === 0) {
				s.animDateIndex = null;
				s.animSummary = null;
				(s as any).prevAnimSummary = null;
			} else {
				// Hover is settled at full strength; no need to keep transition packing state.
				(s as any).prevAnimSummary = null;
			}
		}
	}

	// Always decay outgoing items (even in instant-hover mode). This prevents the
	// previous hover target from collapsing/jumping abruptly when hover snaps.
	{
		const outgoing = (s as any).outgoingSummaries as
			| Array<{ dayIndex: number; itemIndex: number; t: number; startAt?: number; fromT?: number }>
			| null
			| undefined;
		if (outgoing && outgoing.length) {
			const dur = Math.max(1, Number(HOVER_ANIM_TIME_MS) || 1);
			let anyStill = false;
			for (let i = 0; i < outgoing.length; i++) {
				const o = outgoing[i]!;
				const ot = clamp01(Number(o.t));
				if (!Number.isFinite(o.startAt as any)) {
					o.startAt = now;
					o.fromT = ot;
				}
				const fromT = clamp01(Number(o.fromT));
				const tLin = clamp01((now - Number(o.startAt)) / dur);
				const eased = cubicBezierEase(tLin, 0.42, 0, 0.58, 1);
				o.t = fromT * (1 - eased);
				if (o.t > 0.001) anyStill = true;
			}
			(s as any).outgoingSummaries = anyStill ? outgoing.filter((o) => (Number(o.t) || 0) > 0.001) : [];
		}

		const outgoingDates = (s as any).outgoingDates as
			| Array<{ index: number; t: number; startAt?: number; fromT?: number }>
			| null
			| undefined;
		if (outgoingDates && outgoingDates.length) {
			const dur = Math.max(1, Number(HOVER_ANIM_TIME_MS) || 1);
			let anyStill = false;
			for (let i = 0; i < outgoingDates.length; i++) {
				const o = outgoingDates[i]!;
				const ot = clamp01(Number(o.t));
				if (!Number.isFinite(o.startAt as any)) {
					o.startAt = now;
					o.fromT = ot;
				}
				const fromT = clamp01(Number(o.fromT));
				const tLin = clamp01((now - Number(o.startAt)) / dur);
				const eased = cubicBezierEase(tLin, 0.42, 0, 0.58, 1);
				o.t = fromT * (1 - eased);
				if (o.t > 0.001) anyStill = true;
			}
			(s as any).outgoingDates = anyStill ? outgoingDates.filter((o) => (Number(o.t) || 0) > 0.001) : [];
		}
	}

	if (dt > 0 && Math.abs(s.velocityY) > 0) {
		const friction = Math.pow(inertia.decay, dt / 16.67);
		s.offsetY += s.velocityY * dt * inertia.boost;
		s.velocityY *= friction;
		if (Math.abs(s.velocityY) < inertia.minVel) {
			s.velocityY = 0;
		}
	}

	try {
		const anyCanvas: any = canvas as any;
		const viewportHeight = resolveViewportHeight(anyCanvas?.root, Number(anyCanvas?.__lastKnownCanvasCssHeight ?? 0));
		if (viewportHeight > 0) {
			const today = typeof anyCanvas?.getToday === "function" ? anyCanvas.getToday() : new Date();
			const prevOffset = s.offsetY;
			s.offsetY = clampTimelineOffsetToBounds({
				offsetY: s.offsetY,
				scale: s.scale,
				viewportHeight,
				today
			});
			s.targetOffsetY = clampTimelineOffsetToBounds({
				offsetY: s.targetOffsetY,
				scale: s.targetScale,
				viewportHeight,
				today
			});
			if (s.offsetY !== prevOffset) {
				s.velocityY = 0;
			}
		}
	} catch {
		// ignore
	}

	if (dt > 0 && (s as any).animatingWheelPan) {
		const remaining = (Number.isFinite(s.targetOffsetY) ? s.targetOffsetY : s.offsetY) - s.offsetY;
		const step = WHEEL_PAN_SPEED_PX_PER_MS * dt;
		if (Math.abs(remaining) <= step) {
			s.offsetY = s.targetOffsetY;
			(s as any).animatingWheelPan = false;
		} else {
			s.offsetY += Math.sign(remaining) * step;
		}
	}

	if (dt > 0 && (s as any).animatingWheelZoom) {
		const targetScale = Number(s.targetScale);
		const curScale = Number(s.scale);
		if (Number.isFinite(targetScale) && Number.isFinite(curScale) && targetScale > 0 && curScale > 0) {
			const curLog = Math.log(curScale);
			const targetLog = Math.log(targetScale);
			const remaining = targetLog - curLog;
			const step = WHEEL_ZOOM_LOG_SPEED_PER_MS * dt;
			if (Math.abs(remaining) <= step) {
				s.scale = targetScale;
				(s as any).animatingWheelZoom = false;
				(s as any).wheelZoomDir = 0;
			} else {
				const dir = remaining > 0 ? 1 : -1;
				s.scale = Math.exp(curLog + dir * step);
			}
			try {
				const anchorY = Number((s as any).wheelZoomAnchorY);
				const worldY = Number((s as any).wheelZoomAnchorWorldY);
				if (Number.isFinite(anchorY) && Number.isFinite(worldY)) {
					s.offsetY = anchorY - worldY * s.scale;
				} else {
					s.offsetY += (s.targetOffsetY - s.offsetY) * Math.min(1, dt / 200);
				}
			} catch {
				// ignore
			}
		} else {
			(s as any).animatingWheelZoom = false;
			(s as any).wheelZoomDir = 0;
		}
	}

	if (dt > 0 && s.animatingView) {
		const t = Math.min(1, dt / 200);
		s.scale += (s.targetScale - s.scale) * t;
		s.offsetY += (s.targetOffsetY - s.offsetY) * t;
		if (
			Math.abs(s.scale - s.targetScale) < 0.001 &&
			Math.abs(s.offsetY - s.targetOffsetY) < 0.5
		) {
			s.scale = s.targetScale;
			s.offsetY = s.targetOffsetY;
			s.animatingView = false;
		}
	}

	if (s.pinFly) {
		const dur = Math.max(1, Number(s.pinFly.durationMs) || 1);
		const t = Math.max(0, Math.min(1, (now - Number(s.pinFly.startAt)) / dur));
		s.pinFly.t = t;
		if (t >= 1) {
			const done = s.pinFlyOnDone;
			s.pinFly = null;
			s.pinFlyOnDone = null;
			if (done) {
				try {
					done();
				} catch {
					// ignore
				}
			}
		}
	}

	const outgoingStill = (() => {
		const out = (s as any).outgoingSummaries as Array<{ t: number }> | null | undefined;
		if (out && out.length) {
			for (let i = 0; i < out.length; i++) {
				const t = Number(out[i]!.t);
				if (Number.isFinite(t) && t > 0.01) return true;
			}
		}
		const outD = (s as any).outgoingDates as Array<{ t: number }> | null | undefined;
		if (outD && outD.length) {
			for (let i = 0; i < outD.length; i++) {
				const t = Number(outD[i]!.t);
				if (Number.isFinite(t) && t > 0.01) return true;
			}
		}
		return false;
	})();
	const stillHover = (s.hoverEaseStartAt != null) || Math.abs(target - s.hoverAnim) >= 0.01 || outgoingStill;
	const stillInertia = Math.abs(s.velocityY) >= 0.01;
	const stillView = s.animatingView || !!(s as any).animatingWheelPan || !!(s as any).animatingWheelZoom;
	const stillPinFly = !!s.pinFly;

	if (stillHover || stillInertia || stillView || stillPinFly) {
		s.requestHoverAnimation();
	} else {
		s.lastFrameTime = null;
	}

	s.draw();
}
