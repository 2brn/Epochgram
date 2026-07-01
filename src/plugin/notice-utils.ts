import { MarkdownView, Notice, type App } from "obsidian";

const activeDocument = typeof window !== "undefined" ? window.document : ({} as Document);


function formatErrorForNotice(err: unknown): string {
	try {
		if (err instanceof Error) {
			const name = err.name ? String(err.name) : "Error";
			const msg = err.message ? String(err.message) : "";
			const stack = err.stack ? String(err.stack) : "";
			return [name + (msg ? (": " + msg) : ""), stack].filter(Boolean).join("\n");
		}
		if (typeof err === "string") return err;
		return JSON.stringify(err, null, 2);
	} catch {
		try {
			return String(err);
		} catch {
			return "Unknown error";
		}
	}
}

export function showPersistentErrorNotice(prefix: string, err: unknown): void {
	const details = formatErrorForNotice(err);
	const text = prefix ? `${prefix}\n\n${details}` : details;
	try {
		new Notice(text, 0);
	} catch {
		try {
			new Notice(text);
		} catch {
			// ignore
		}
	}
}

export function wrapNoticeError<TArgs extends unknown[], TResult>(
	label: string,
	fn: (...args: TArgs) => TResult | Promise<TResult>
): (...args: TArgs) => void {
	return (...args: TArgs) => {
		try {
			const out = fn(...args);
			Promise.resolve(out).catch((e) => showPersistentErrorNotice(label, e));
		} catch (e) {
			showPersistentErrorNotice(label, e);
		}
	};
}

export function isUserEditingMarkdown(app: App): boolean {
	try {
		const view = app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return false;

		// Prefer the editor focus signal when available.
		const viewWithEditor = view as MarkdownView & { editor?: { hasFocus?: () => boolean } };
		const editor = viewWithEditor.editor ?? null;
		if (editor && typeof editor.hasFocus === "function" && editor.hasFocus()) return true;

		// Fallback: check DOM focus within the markdown editor.
		if (typeof activeDocument === "undefined") return false;
		const activeEl = activeDocument.activeElement as HTMLElement | null;
		if (!activeEl) return false;
		const viewWithElements = view as MarkdownView & { contentEl?: HTMLElement; containerEl?: HTMLElement };
		const contentEl: HTMLElement | null = viewWithElements.contentEl ?? viewWithElements.containerEl ?? null;
		if (!contentEl || !contentEl.contains(activeEl)) return false;

		return !!activeEl.closest(".cm-editor, .markdown-source-view, .cm-scroller");
	} catch {
		return false;
	}
}
