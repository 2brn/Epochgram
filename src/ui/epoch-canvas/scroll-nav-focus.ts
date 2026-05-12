import type { EpochCanvas } from "../epoch-canvas";

import {
	focusDate as focusDateHelper,
	dateKeyToDate as dateKeyToDateHelper,
	getDayIndexForDate as getDayIndexForDateHelper,
	getSourcePriority
} from "../epoch-canvas-focus";
import { buildMiniSearchQueryParts, getEntriesForDate, pickEntryForFile } from "../entry-helpers";
import { BASE_SPACING, FOCUS_ANCHOR_RATIO } from "../epoch-canvas-constants";
import { parseTimelineQuery } from "../timeline-search";

function isRecurringEntry(entry: unknown): boolean {
	return (entry as any)?.recurring === true;
}

function filterNonRecurringEntries<T>(entries: T[]): T[] {
	return (entries ?? []).filter((e) => !isRecurringEntry(e));
}

export function focusFirstFilteredTimelineRecord(canvas: EpochCanvas): boolean {
	const c: any = canvas as any;
	try {
		const rect = c.root?.getBoundingClientRect?.();
		if (!rect || !rect.width || !rect.height) {
			c.__pendingFocusFirstFilteredTimelineRecord = true;
			c.pendingVisibilityDraw = true;
			c.scheduleVisibilityCheck?.();
			return true;
		}
	} catch {
		// ignore
	}

	const rawQuery = String(c.searchQuery || "").trim();
	if (rawQuery) {
		try {
			const pluginAny: any = c.plugin;
			const idx: any = pluginAny?.timelineSearchIndex;
			if (idx && typeof idx.searchFileIdsRanked === "function") {
				const parsed = parseTimelineQuery(rawQuery);
				const { includeText, excludeTokens, exactPhrases, excludedPhrases, hasAnySearch } = buildMiniSearchQueryParts(parsed);
				if (hasAnySearch) {
					const ranked: unknown = idx.searchFileIdsRanked({ includeText, excludeTokens, exactPhrases, excludedPhrases });
					const rankedList = Array.isArray(ranked) ? (ranked as any[]) : [];
					for (const fpRaw of rankedList) {
						const filePath = String(fpRaw || "");
						if (!filePath) continue;

						const index: any = c.index ?? null;
						if (!index || typeof index !== "object") continue;

						let bestDateNonRecurring: Date | null = null;
						let bestNonRecurring: { priority: number; ms: number } | null = null;
						let bestDateOldestRecurring: Date | null = null;
						let bestOldestRecurringMs = Number.POSITIVE_INFINITY;
						for (const dateKey of Object.keys(index)) {
							const date = dateKeyToDateHelper(dateKey);
							if (!date) continue;
							const entries = getEntriesForDate(canvas, date);
							if (!entries || entries.length === 0) continue;
							const nonRecurring = filterNonRecurringEntries(entries as any);
							const recurringOnly = (entries ?? []).filter((e: any) => isRecurringEntry(e));
							const matchNonRecurring =
								nonRecurring.length > 0
									? pickEntryForFile(canvas, nonRecurring as any, filePath, null)
									: null;
							const matchRecurring =
								recurringOnly.length > 0
									? pickEntryForFile(canvas, recurringOnly as any, filePath, null)
									: null;
							if (!matchNonRecurring && !matchRecurring) continue;
							const ms = date.getTime();
							if (!Number.isFinite(ms)) continue;
							if (matchNonRecurring) {
								const priority = getSourcePriority((matchNonRecurring as any)?.source);
								if (
									!bestNonRecurring ||
									priority < bestNonRecurring.priority ||
									(priority === bestNonRecurring.priority && ms > bestNonRecurring.ms)
								) {
									bestNonRecurring = { priority, ms };
									bestDateNonRecurring = date;
								}
							}
							if (matchRecurring) {
								if (ms < bestOldestRecurringMs) {
									bestOldestRecurringMs = ms;
									bestDateOldestRecurring = date;
								}
							}
						}

						const bestDate = bestDateNonRecurring ?? bestDateOldestRecurring;
						if (!bestDate) continue;
						try {
							c.scrollNavFile = filePath;
							c.scrollNavIndex = 0;
							c.scrollNavAnchorEntry = null;
							c.scrollNavAnchorDayIndex = getDayIndexForDateHelper(canvas, bestDate);
							c.pendingScrollNavHighlight = null;
						} catch {
							// ignore
						}
						c.animatingView = true;
						focusDateHelper(canvas, bestDate, true, true, true);
						return true;
					}
				}
			}
		} catch {
			// ignore
		}
	}

	const index: any = c.index ?? null;
	if (!index || typeof index !== "object") return false;
	let bestDateNonRecurring: Date | null = null;
	let bestNonRecurringMs = Number.NEGATIVE_INFINITY;
	let bestDateOldestRecurring: Date | null = null;
	let bestOldestRecurringMs = Number.POSITIVE_INFINITY;
	for (const dateKey of Object.keys(index)) {
		const date = dateKeyToDateHelper(dateKey);
		if (!date) continue;
		const entries = getEntriesForDate(canvas, date);
		if (!entries || entries.length === 0) continue;
		const ms = date.getTime();
		if (!Number.isFinite(ms)) continue;
		if (filterNonRecurringEntries(entries as any).length > 0) {
			if (ms > bestNonRecurringMs) {
				bestNonRecurringMs = ms;
				bestDateNonRecurring = date;
			}
		}
		if ((entries ?? []).some((e: any) => isRecurringEntry(e))) {
			if (ms < bestOldestRecurringMs) {
				bestOldestRecurringMs = ms;
				bestDateOldestRecurring = date;
			}
		}
	}
	const bestDate = bestDateNonRecurring ?? bestDateOldestRecurring;
	if (!bestDate) return false;
	let dayIndex: number | null = null;
	try {
		const di0 = getDayIndexForDateHelper(canvas, bestDate);
		dayIndex = Number.isFinite(di0) ? Number(di0) : null;
	} catch {
		dayIndex = null;
	}
	try {
		c.scrollNavIndex = 0;
		c.scrollNavAnchorEntry = null;
		c.scrollNavAnchorDayIndex = dayIndex;
		c.pendingScrollNavHighlight = null;
	} catch {
		// ignore
	}
	c.animatingView = true;
	focusDateHelper(canvas, bestDate, true, true, true);
	return true;
}

export function snapFirstFilteredTimelineRecord(canvas: EpochCanvas, options: { draw?: boolean } = {}): boolean {
	const c: any = canvas as any;
	try {
		const rect = c.root?.getBoundingClientRect?.();
		if (!rect || !rect.width || !rect.height) {
			return false;
		}
	} catch {
		// ignore
	}
	const index: any = c.index ?? null;
	if (!index || typeof index !== "object") return false;

	const rawQuery = String(c.searchQuery || "").trim();
	let bestDateNonRecurring: Date | null = null;
	let bestNonRecurring: { priority: number; ms: number } | null = null;
	let bestDateOldestRecurring: Date | null = null;
	let bestOldestRecurringMs = Number.POSITIVE_INFINITY;
	let bestDate: Date | null = null;
	if (rawQuery) {
		try {
			const pluginAny: any = c.plugin;
			const idx: any = pluginAny?.timelineSearchIndex;
			if (idx && typeof idx.searchFileIdsRanked === "function") {
				const parsed = parseTimelineQuery(rawQuery);
				const { includeText, excludeTokens, exactPhrases, excludedPhrases, hasAnySearch } = buildMiniSearchQueryParts(parsed);
				if (hasAnySearch) {
					const ranked: unknown = idx.searchFileIdsRanked({ includeText, excludeTokens, exactPhrases, excludedPhrases });
					const rankedList = Array.isArray(ranked) ? (ranked as any[]) : [];
					for (const fpRaw of rankedList) {
						const filePath = String(fpRaw || "");
						if (!filePath) continue;
						for (const dateKey of Object.keys(index)) {
							const date = dateKeyToDateHelper(dateKey);
							if (!date) continue;
							const entries = getEntriesForDate(canvas, date);
							if (!entries || entries.length === 0) continue;
							const nonRecurring = filterNonRecurringEntries(entries as any);
							const recurringOnly = (entries ?? []).filter((e: any) => isRecurringEntry(e));
							const matchNonRecurring =
								nonRecurring.length > 0
									? pickEntryForFile(canvas, nonRecurring as any, filePath, null)
									: null;
							const matchRecurring =
								recurringOnly.length > 0
									? pickEntryForFile(canvas, recurringOnly as any, filePath, null)
									: null;
							if (!matchNonRecurring && !matchRecurring) continue;
							const ms = date.getTime();
							if (!Number.isFinite(ms)) continue;
							if (matchNonRecurring) {
								const priority = getSourcePriority((matchNonRecurring as any)?.source);
								if (
									!bestNonRecurring ||
									priority < bestNonRecurring.priority ||
									(priority === bestNonRecurring.priority && ms > bestNonRecurring.ms)
								) {
									bestNonRecurring = { priority, ms };
									bestDateNonRecurring = date;
								}
							}
							if (matchRecurring) {
								if (ms < bestOldestRecurringMs) {
									bestOldestRecurringMs = ms;
									bestDateOldestRecurring = date;
								}
							}
						}
						bestDate = bestDateNonRecurring ?? bestDateOldestRecurring;
						if (bestDate) {
							try {
								c.scrollNavFile = filePath;
							} catch {
								// ignore
							}
							break;
						}
					}
				}
			}
		} catch {
			// ignore
		}
	}

	if (!bestDate) {
		let bestNonRecurringMs = Number.NEGATIVE_INFINITY;
		let bestOldestRecurringMs = Number.POSITIVE_INFINITY;
		let bestDateOldestRecurring: Date | null = null;
		for (const dateKey of Object.keys(index)) {
			const date = dateKeyToDateHelper(dateKey);
			if (!date) continue;
			const entries = getEntriesForDate(canvas, date);
			if (!entries || entries.length === 0) continue;
			const ms = date.getTime();
			if (!Number.isFinite(ms)) continue;
			if (filterNonRecurringEntries(entries as any).length > 0) {
				if (ms > bestNonRecurringMs) {
					bestNonRecurringMs = ms;
					bestDateNonRecurring = date;
				}
			}
			if ((entries ?? []).some((e: any) => isRecurringEntry(e))) {
				if (ms < bestOldestRecurringMs) {
					bestOldestRecurringMs = ms;
					bestDateOldestRecurring = date;
				}
			}
		}
		bestDate = bestDateNonRecurring ?? bestDateOldestRecurring;
	}
	if (!bestDate) return false;

	const rect = c.root.getBoundingClientRect();
	if (!rect.height) return false;
	const dayIndex = getDayIndexForDateHelper(canvas, bestDate);
	const worldY = dayIndex * BASE_SPACING;
	const s = Number.isFinite(c.scale) && c.scale > 0 ? c.scale : 1;
	const anchorY = rect.height * FOCUS_ANCHOR_RATIO;
	const nextOffsetY = anchorY - worldY * s;
	try {
		c.scale = s;
		c.targetScale = s;
		c.offsetY = nextOffsetY;
		c.targetOffsetY = nextOffsetY;
		c.animatingView = false;
		c.pendingScrollNavHighlight = null;
		c.scrollNavAnchorEntry = null;
		c.scrollNavAnchorDayIndex = dayIndex;
		c.hoverSummary = null;
		c.animSummary = null;
		c.hoverTarget = 0;
	} catch {
		// ignore
	}
	if (options.draw !== false) {
		try {
			(c as any).draw?.();
		} catch {
			// ignore
		}
	}
	return true;
}

export function focusFilteredTimelineRecordForFile(canvas: EpochCanvas, filePath: string): boolean {
	const c: any = canvas as any;
	try {
		const rect = c.root?.getBoundingClientRect?.();
		if (!rect || !rect.width || !rect.height) {
			return false;
		}
	} catch {
		// ignore
	}
	const index: any = c.index ?? null;
	if (!index || typeof index !== "object") return false;
	const fp = String(filePath || "");
	if (!fp) return false;

	let bestDateNonRecurring: Date | null = null;
	let bestNonRecurring: { priority: number; ms: number } | null = null;
	for (const dateKey of Object.keys(index)) {
		const date = dateKeyToDateHelper(dateKey);
		if (!date) continue;
		const entries = getEntriesForDate(canvas, date);
		if (!entries || entries.length === 0) continue;
		const nonRecurring = filterNonRecurringEntries(entries as any);
		if (nonRecurring.length === 0) continue;
		const match = pickEntryForFile(canvas, nonRecurring as any, fp, null);
		if (!match) continue;
		const ms = date.getTime();
		if (!Number.isFinite(ms)) continue;
		const priority = getSourcePriority((match as any)?.source);
		if (!bestNonRecurring || priority < bestNonRecurring.priority || (priority === bestNonRecurring.priority && ms > bestNonRecurring.ms)) {
			bestNonRecurring = { priority, ms };
			bestDateNonRecurring = date;
		}
	}
	const bestDate = bestDateNonRecurring;
	if (!bestDate) return false;

	try {
		c.scrollNavFile = fp;
		c.scrollNavIndex = 0;
		c.scrollNavAnchorEntry = null;
		c.scrollNavAnchorDayIndex = getDayIndexForDateHelper(canvas, bestDate);
		c.pendingScrollNavHighlight = null;
	} catch {
		// ignore
	}
	c.animatingView = true;
	focusDateHelper(canvas, bestDate, true, true, true);
	return true;
}
