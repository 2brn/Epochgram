export const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const BASE_SPACING = 100;

export const DAY_LABEL_MIN_SCALE = 0.35;
export const DAY_DOT_MIN_SCALE = 0.2;
export const MONTH_LABEL_MIN_SCALE = 0.015;
export const MONTH_DOT_MIN_SCALE = 0.01;
export const YEAR_LABEL_MIN_SCALE = 0.0015;
export const SUMMARY_MIN_SCALE = 0.25;

export const MIN_SCALE = 0.0015;
export const MAX_SCALE = 10000;
export const ZOOM_INTENSITY = 0.003;

export const VERTICAL_PADDING = 400;
export const TIMELINE_X = 49;
export const LINE_EXTRA = 2000;

export const DOT_RADIUS_DAY = 4;
export const DOT_RADIUS_MONTH = 6;
export const DOT_RADIUS_YEAR = 6;
export const TODAY_RADIUS = 6;
export const TIMELINE_MARKER_STROKE_WIDTH = 1.5;

export const DATE_RECT_HALF_HEIGHT = 12;
export const DATE_RECT_RIGHT_EXTRA = 40;
export const LABEL_OFFSET_X = 10;

export const SUMMARY_MARGIN = 6;
export const SUMMARY_ROW_HEIGHT = 25;
export const SUMMARY_RIGHT_MARGIN = 16;
export const SUMMARY_OFFSET_X = 16;
export const SUMMARY_MIN_WIDTH = 40;
export const SUMMARY_MAX_COL_WIDTH = 500;
export const SUMMARY_COLUMN_GAP = 8;
export const SUMMARY_FONT_ZOOM_MAX = 1.2;
export const SUMMARY_FONT_ZOOM_RATE = 0.3;
export const SUMMARY_FONT_MIN_PX = 6;

export const SUMMARY_ICON_BASE_SIZE = 8;
export const SUMMARY_ICON_MIN_SIZE = 8;
export const SUMMARY_ICON_MAX_SIZE = 12;
export const SUMMARY_ICON_GAP = 3;
export const SUMMARY_ICON_TEXT_GAP = 6;

export const SUMMARY_PLACEHOLDER_STROKE_WIDTH = 1;

export const SUMMARY_DENSE_BAR_MIN_HEIGHT = 0.5;
export const SUMMARY_DENSE_BAR_MAX_HEIGHT = SUMMARY_ROW_HEIGHT;
// Reference entry count used only for dense-bar height scaling fallbacks.
// Dense-mode decisions are no longer based on entry-count thresholds.
export const SUMMARY_DENSE_HEIGHT_FALLBACK_REF_COUNT = 100;
export const SUMMARY_DENSE_GLOBAL_THRESHOLD = 100;

// Epochs view: canvas "drop-cap" scale multiplier for the first line prefix.
export const DROP_CAP_SCALE = 2.0;

// Epochs view: mapping from zoom scale -> epoch bucket
// The base threshold is tuned for the existing canvas zoom scale.
// Larger buckets become active as you zoom out.
const EPOCH_BUCKET_DAY_MIN_SCALE = 0.85;

// Epochs view: fade between bucket changes on zoom
export const EPOCH_BUCKET_TRANSITION_MS = 500;

// Epochs view: choose the most detailed bucket that still keeps the number of
// visible epoch blocks reasonable for the current viewport height.
// If no bucket satisfies the constraint, fall back to the default scale-based mapping.
const EPOCH_BUCKET_MAX_BLOCKS_ON_SCREEN = 15;

import { EPOCH_BUCKETS, epochBucketRoughDays, type EpochBucket } from "../indexer/types";

export type EpochBucketName = EpochBucket;

function pickEpochBucket(scale: number): EpochBucketName {
	// Heuristic mapping from zoom scale to time bucket.
	// Uses existing scale conventions in this codebase (day/month/year labels).
	// Thresholds scale ~ 1 / roughDays.
	for (const bucket of EPOCH_BUCKETS) {
		const roughDays = epochBucketRoughDays(bucket);
		const minScale = EPOCH_BUCKET_DAY_MIN_SCALE / roughDays;
		if (scale >= minScale) return bucket;
	}
	return "year";
}

export function pickEpochBucketForViewport(scale: number, viewportHeightPx: number): EpochBucketName {
	const s = Number(scale);
	const h = Number(viewportHeightPx);
	if (!Number.isFinite(s) || s <= 0) return pickEpochBucket(s);
	if (!Number.isFinite(h) || h <= 0) return pickEpochBucket(s);

	const dayPx = BASE_SPACING * s;
	if (!Number.isFinite(dayPx) || dayPx <= 0.0001) return pickEpochBucket(s);

	const approxVisibleDays = h / dayPx;
	if (!Number.isFinite(approxVisibleDays) || approxVisibleDays <= 0) return pickEpochBucket(s);

	for (const bucket of EPOCH_BUCKETS) {
		const roughDays = epochBucketRoughDays(bucket);
		const blocks = approxVisibleDays / roughDays;
		if (blocks <= EPOCH_BUCKET_MAX_BLOCKS_ON_SCREEN) return bucket;
	}

	return pickEpochBucket(s);
}

export const SUMMARY_PREFIX_SEPARATOR = " ";
export const SUMMARY_SEPARATOR_SYMBOL = "⸱";
export const SUMMARY_ENTRY_SEPARATOR = ` ${SUMMARY_SEPARATOR_SYMBOL} `;

export const SUMMARY_ICON_TRACKED_ADDED = "pen";
export const SUMMARY_ICON_TRACKED_REMOVED = "pen-line";
export const SUMMARY_ICON_TRACKED_MODIFIED = "pen";
export const SUMMARY_ICON_NOTE = "";
export const SUMMARY_ICON_PARSED = "calendar";
export const SUMMARY_ICON_RECURRING = "refresh-cw";
export const SUMMARY_ICON_ATTACHMENT = "paperclip";
export const SUMMARY_ICON_PIN = "pin-fill";

export const HOVER_EXTRA_GAP = 4;
export const SUMMARY_RECORD_SAFE_MARGIN = 2;
export const HOVER_BG_PAD = 0;
// Hover hit-testing should be tighter than click/touch hit-testing.
export const HOVER_HIT_PAD = 0;
export const HOVER_PREVIEW_RETRIGGER_DELAY_MS = 500;
export const DATE_OVERLAY_VISIBILITY_MS = 1500;
export const TOUCH_HIT_PAD = 10;
// Extra padding for touch hit-testing on date labels (e.g., long-press context menu).
export const DATE_TOUCH_HIT_PAD = 18;
export const TAP_MAX_DURATION = 200;
// Long-press threshold for showing context menus on touch.
export const LONG_PRESS_MS = 200;
// Longer threshold for toggling normal <-> epochs from an empty-area long-press on touch.
export const LONG_PRESS_TOGGLE_VIEW_MS = 500;
export const DOUBLE_TAP_MAX_DELAY = 300;
export const DOUBLE_TAP_MAX_DIST = 50;

export const TODAY_OFFSET_Y_INITIAL = 80;
// Hover animation time constant (ms). Larger = slower (longer) fade.
export const HOVER_ANIM_TIME_MS = 200;

export const FOCUS_ANCHOR_RATIO = 0.33;
export const SUMMARY_HIDDEN_ALPHA = 0.38;

export const INERTIA_DECAY = 0.98;
export const INERTIA_MIN_VELOCITY = 0.01;
export const INERTIA_BOOST = 2.0;
