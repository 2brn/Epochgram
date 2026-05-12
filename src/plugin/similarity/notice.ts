import { Notice, Platform } from "obsidian";
import type { EpochPlugin } from "../../main";
import { isUserEditingMarkdown } from "../notice-utils";
import { now } from "./time";

export function shouldShowSimilarityProgressNotice(plugin: EpochPlugin): boolean {
	const anyPlugin: any = plugin as any;
	const last = typeof anyPlugin.lastSimilarityProgressNoticeAt === "number" ? anyPlugin.lastSimilarityProgressNoticeAt : 0;
	const minMs = Platform.isMobileApp ? 10000 : 1000;
	if (now() - last < minMs) return false;
	anyPlugin.lastSimilarityProgressNoticeAt = now();
	return true;
}

export function shouldAllowSimilarityProgressNotice(plugin: EpochPlugin, startedAtKey: string): boolean {
	try {
		const anyPlugin: any = plugin as any;
		const startedAt = Number(anyPlugin?.[startedAtKey] ?? 0);
		if (!(Number.isFinite(startedAt) && startedAt > 0)) return true;
		// Grace period: avoid progress notices for very fast operations.
		const graceMs = Platform.isMobileApp ? 10000 : 1000;
		return now() - startedAt >= graceMs;
	} catch {
		return true;
	}
}

export function scheduleSimilarityNoticeAfterGrace(
	plugin: EpochPlugin,
	startedAtKey: string,
	message: string,
	timeoutMs: number
): void {
	try {
		if (isUserEditingMarkdown(plugin.app)) return;
		const anyPlugin: any = plugin as any;
		const startedAt = Number(anyPlugin?.[startedAtKey] ?? 0);
		if (!(Number.isFinite(startedAt) && startedAt > 0)) {
			new Notice(message, timeoutMs);
			return;
		}
		const elapsed = now() - startedAt;
		const graceMs = Platform.isMobileApp ? 10000 : 1000;
		const remaining = graceMs - elapsed;
		// If the operation finished quickly (<grace), do not show any progress notice.
		if (remaining > 0) return;
		// Only show if the operation is still considered "in progress" (some queues
		// reset their startedAtKey to 0 when done).
		const startedAtStill = Number(anyPlugin?.[startedAtKey] ?? 0);
		if (!(Number.isFinite(startedAtStill) && startedAtStill > 0)) return;
		new Notice(message, timeoutMs);
	} catch {
		// ignore
	}
}

export function shouldShowVectorUpdateNotice(plugin: EpochPlugin): boolean {
	const anyPlugin: any = plugin as any;
	const last = typeof anyPlugin.lastSimilarityVectorNoticeAt === "number" ? anyPlugin.lastSimilarityVectorNoticeAt : 0;
	const minMs = Platform.isMobileApp ? 10000 : 1000;
	if (now() - last < minMs) return false;
	anyPlugin.lastSimilarityVectorNoticeAt = now();
	return true;
}

export function shouldShowTermSimilarityUpdateNotice(plugin: EpochPlugin): boolean {
	const anyPlugin: any = plugin as any;
	const last = typeof anyPlugin.lastTermSimilarityNoticeAt === "number" ? anyPlugin.lastTermSimilarityNoticeAt : 0;
	const minMs = Platform.isMobileApp ? 10000 : 1000;
	if (now() - last < minMs) return false;
	anyPlugin.lastTermSimilarityNoticeAt = now();
	return true;
}
