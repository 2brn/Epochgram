import {
	DATE_RECT_HALF_HEIGHT,
	DATE_RECT_RIGHT_EXTRA,
	DAY_DOT_MIN_SCALE,
	DAY_LABEL_MIN_SCALE,
	DOT_RADIUS_DAY,
	DOT_RADIUS_MONTH,
	DOT_RADIUS_YEAR,
	LABEL_OFFSET_X,
	MONTH_DOT_MIN_SCALE,
	MONTH_LABEL_MIN_SCALE,
	TIMELINE_MARKER_STROKE_WIDTH,
	TIMELINE_X,
	TODAY_RADIUS,
	YEAR_LABEL_MIN_SCALE
} from "../../epoch-canvas-constants";
import { mixFont } from "../../epoch-canvas-utils";

export type DayMarkerKind = "day" | "month" | "year";

export function drawDayMarker(params: {
	ctx: CanvasRenderingContext2D;
	dayIndex: number;
	yScreen: number;
	date: Date;
	scale: number;
	hoverT: number;
	fontMain: string;
	fontMainHover: string;
	colTextBase: string;
	colSummaryHoverBg: string;
	colToday: string;
	hideLabel?: boolean;
}): {
	kind: DayMarkerKind;
	label: string | null;
	hasVisibleDate: boolean;
	dateRect: { x1: number; y1: number; x2: number; y2: number };
} {
	const {
		ctx,
		dayIndex,
		yScreen,
		date,
		scale,
		hoverT,
		fontMain,
		fontMainHover,
		colTextBase,
		colSummaryHoverBg,
		colToday,
		hideLabel
	} = params;

	const isToday = dayIndex === 0;
	const d = date.getDate();
	const m = date.getMonth();
	const y = date.getFullYear();
	const dayOfWeek = date.getDay();
	const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

	const isYearStart = d === 1 && m === 0;
	const isMonthStart = d === 1 && m !== 0;

	let label: string | null = null;
	let kind: DayMarkerKind = "day";

	if (isYearStart) {
		if (scale >= YEAR_LABEL_MIN_SCALE) {
			label = String(y);
		}
		kind = "year";
	} else if (isMonthStart) {
		if (scale >= MONTH_LABEL_MIN_SCALE) {
			label = date.toLocaleString("default", { month: "short" });
		}
		kind = "month";
	} else {
		if (scale >= DAY_LABEL_MIN_SCALE) {
			label = String(d);
		}
		kind = "day";
	}

	let showDot = true;
	let dotRadius = DOT_RADIUS_DAY;

	if (isToday) {
		showDot = false;
	} else if (isYearStart) {
		dotRadius = DOT_RADIUS_YEAR;
	} else if (isMonthStart) {
		dotRadius = DOT_RADIUS_MONTH;
		if (scale < MONTH_DOT_MIN_SCALE) showDot = false;
	} else {
		dotRadius = DOT_RADIUS_DAY;
		if (scale < DAY_DOT_MIN_SCALE) showDot = false;
	}

	if (showDot && hoverT > 0) {
		dotRadius += 3 * Math.max(0, Math.min(1, hoverT));
	}

	const dateRect = {
		x1: TIMELINE_X - (LABEL_OFFSET_X + 40),
		y1: yScreen - DATE_RECT_HALF_HEIGHT,
		x2: TIMELINE_X + DATE_RECT_RIGHT_EXTRA,
		y2: yScreen + DATE_RECT_HALF_HEIGHT
	};

	const dateColor = colTextBase;
	const dateFont = mixFont(fontMain, fontMainHover, hoverT);

	if (showDot) {
		ctx.save();
		ctx.beginPath();
		ctx.arc(TIMELINE_X, yScreen, dotRadius, 0, Math.PI * 2);
		if (isWeekend) {
			ctx.fillStyle = dateColor;
			ctx.fill();
		} else {
			ctx.fillStyle = colSummaryHoverBg;
			ctx.fill();
			ctx.strokeStyle = dateColor;
			ctx.lineWidth = TIMELINE_MARKER_STROKE_WIDTH + 0.8 * Math.max(0, Math.min(1, hoverT));
			const strokeRadius = Math.max(0.5, dotRadius - ctx.lineWidth / 2);
			ctx.beginPath();
			ctx.arc(TIMELINE_X, yScreen, strokeRadius, 0, Math.PI * 2);
			ctx.stroke();
		}
		ctx.restore();
	}

	if (label && !hideLabel) {
		ctx.save();
		ctx.fillStyle = dateColor;
		ctx.font = dateFont;
		ctx.textAlign = "right";
		const extra = kind === "year" ? 0 : 4 * hoverT;
		ctx.fillText(label, TIMELINE_X - LABEL_OFFSET_X - extra, yScreen);
		ctx.restore();
	}

	if (isToday) {
		ctx.save();
		const radius = TODAY_RADIUS + 3 * hoverT;

		ctx.beginPath();
		ctx.arc(TIMELINE_X, yScreen, radius, 0, Math.PI * 2);
		if (isWeekend) {
			ctx.fillStyle = colToday;
			ctx.fill();
		} else {
			ctx.fillStyle = colSummaryHoverBg;
			ctx.fill();
			ctx.strokeStyle = colToday;
			ctx.lineWidth = TIMELINE_MARKER_STROKE_WIDTH;
			const strokeRadius = Math.max(0.5, radius - ctx.lineWidth / 2);
			ctx.beginPath();
			ctx.arc(TIMELINE_X, yScreen, strokeRadius, 0, Math.PI * 2);
			ctx.stroke();
		}
		ctx.restore();
	}

	const hasVisibleDate = showDot || !!label || isToday;

	return { kind, label, hasVisibleDate, dateRect };
}
