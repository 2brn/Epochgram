import type { EpochPlugin } from "../../main";

export function devConsoleLogOnce(plugin: EpochPlugin, key: string, message: string): void {
	void plugin;
	void key;
	void message;
}

export function devConsoleWarnOnce(plugin: EpochPlugin, key: string, message: string): void {
	void plugin;
	void key;
	void message;
}

export function debugLog(...args: any[]): void {
	// Intentionally no-op: user requested no DevTools console logs.
	void args;
}

export function safeStringify(value: any, maxLen: number = 2000): string {
	try {
		const s = JSON.stringify(value);
		if (!s) return "";
		return s.length > maxLen ? s.slice(0, maxLen) + "..." : s;
	} catch {
		try {
			return String(value);
		} catch {
			return "";
		}
	}
}
