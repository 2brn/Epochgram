import { App, Platform, SuggestModal } from "obsidian";
import type { DateEntry } from "../../indexer/types";
import { SUMMARY_SEPARATOR_SYMBOL } from "../epoch-canvas-constants";
import { setCssStyles } from "../../dom";

export type TimelineSearchSuggestion =
	| { kind: "empty" }
	| { kind: "filter"; query: string }
	| { kind: "record"; entry: DateEntry; label: string };

export class TimelineSearchModal extends SuggestModal<TimelineSearchSuggestion> {
	private static readonly MAX_SUGGESTIONS = 7;
	private static sessionLastNonEmptyQuery = "";

	private titleText: string;
	private initialValue: string;
	private onCommit: ((value: string) => void) | null;
	private getTopMatches: ((query: string, max: number) => Array<{ entry: DateEntry; label?: string }>) | null;
	private onChooseRecord: ((entry: DateEntry, query: string) => void) | null;
	private latestQuery = "";
	private effectiveQuery = "";
	private priorActiveElement: HTMLElement | null = null;
	private handleInput: () => void;
	private handleKeyDown: (evt: KeyboardEvent) => void;
	private committed = false;

	constructor(
		app: App,
		options: {
			title?: string;
			initial: string;
			onCommit?: (value: string) => void;
			getTopMatches?: (query: string, max: number) => Array<{ entry: DateEntry; label?: string }>;
			onChooseRecord?: (entry: DateEntry, query: string) => void;
		}
	) {
		super(app);
		this.priorActiveElement = (typeof document !== "undefined" ? (document.activeElement as any) : null) as HTMLElement | null;
		this.titleText = String(options?.title ?? "Search");
		this.initialValue = String(options?.initial ?? "");
		this.onCommit = typeof options?.onCommit === "function" ? options.onCommit : null;
		this.getTopMatches = typeof options?.getTopMatches === "function" ? options.getTopMatches : null;
		this.onChooseRecord = typeof options?.onChooseRecord === "function" ? options.onChooseRecord : null;
		this.setPlaceholder("Search timeline...");
		const filterKeyLabel = Platform.isMacOS ? "opt" : "alt";
		const instructions = [
			{ command: "\"exact\"", purpose: "" },
			{ command: "$marked", purpose: "" },
			{ command: "$hidden", purpose: "" },
			{ command: "$similar", purpose: "" },
			{ command: "↵", purpose: "to open" },
			{ command: `${filterKeyLabel} ↵`, purpose: "to filter" },
			{ command: "esc", purpose: "to dismiss" }
		] as Array<{ command: string; purpose: string }>;
		this.setInstructions(instructions);
		this.handleInput = () => {
			try {
				const v = String(this.inputEl.value || "");
				this.latestQuery = v;
				const vTrim = v.trim();
				if (!vTrim) {
					this.effectiveQuery = "";
					TimelineSearchModal.sessionLastNonEmptyQuery = "";
				}
			} catch {}
			try {
				(this as any).onInputChanged?.();
			} catch {}
		};
		this.handleKeyDown = (evt: KeyboardEvent) => {
			try {
				if (!evt) return;
				if (evt.key !== "Enter") return;
				if (!evt.altKey) return;
				evt.preventDefault?.();
				evt.stopPropagation?.();
				const q = String(this.latestQuery || "");
				const qTrim = q.trim();
				if (!qTrim) {
					TimelineSearchModal.sessionLastNonEmptyQuery = "";
				} else {
					TimelineSearchModal.sessionLastNonEmptyQuery = qTrim;
				}
				this.onCommit?.(q);
				this.committed = true;
				this.close();
			} catch {
				// ignore
			}
		};
	}

	onOpen() {
		void super.onOpen();
		this.committed = false;
		this.modalEl.addClass("mod-epochgram-timeline-search");
		this.titleEl.setText(this.titleText);
		this.inputEl.type = "search";
		this.inputEl.value = this.initialValue;
		this.inputEl.dispatchEvent(new Event("input"));
		this.inputEl.addEventListener("input", this.handleInput);
		this.inputEl.addEventListener("keydown", this.handleKeyDown);

		(globalThis as any).setTimeout?.(() => {
			try {
				this.inputEl.focus();
				const n = String(this.inputEl.value || "").length;
				this.inputEl.setSelectionRange(n, n);
			} catch {}
		}, 0);

		// Emit once to ensure the UI is in sync with the prefilled value.
		try {
			(this as any).onInputChanged?.();
		} catch {}
	}

	onClose() {
		this.inputEl.removeEventListener("input", this.handleInput);
		this.inputEl.removeEventListener("keydown", this.handleKeyDown);
		void super.onClose();
		if (Platform.isMobile) {
			this.priorActiveElement = null;
			return;
		}
		const el = this.priorActiveElement;
		this.priorActiveElement = null;
		if (el && typeof el.focus === "function") {
			try {
				(el as any).focus?.({ preventScroll: true });
			} catch {
				try {
					el.focus();
				} catch {
					// ignore
				}
			}
		}
	}

	getSuggestions(query: string): TimelineSearchSuggestion[] {
		const prevLatestQuery = String(this.latestQuery || "");
		const prevLatestTrim = prevLatestQuery.trim();
		const q = String(query || "");
		this.latestQuery = q;
		const qTrim = q.trim();
		const out: TimelineSearchSuggestion[] = [];
		const seenFiles = new Set<string>();

		const getter = this.getTopMatches;
		const pushTopRecords = (getterQuery: string, maxRecords: number) => {
			try {
				if (!getter) return;
				const matches = getter(getterQuery, maxRecords) ?? [];
				let pushed = 0;
				for (const m of matches) {
					if (pushed >= maxRecords) break;
					const entry = (m as any)?.entry as DateEntry | null | undefined;
					if (!entry) continue;
					const p = String((entry as any)?.file ?? "");
					if (!p) continue;
					if (seenFiles.has(p)) continue;
					seenFiles.add(p);
					const label = String((m as any)?.label ?? p);
					out.push({ kind: "record", entry, label });
					pushed++;
				}
			} catch {
				// ignore
			}
		};

		const toggleHasSuggestions = () => {
			try {
				this.modalEl.toggleClass("has-suggestions", out.length > 0);
			} catch {}
		};

		if (!qTrim) {
			// If the user cleared a previously-non-empty query (e.g., backspace),
			// treat this as an explicit reset back to the default suggestions.
			if (prevLatestTrim) {
				TimelineSearchModal.sessionLastNonEmptyQuery = "";
			}
			this.effectiveQuery = "";
			pushTopRecords("", TimelineSearchModal.MAX_SUGGESTIONS);
			out.push({ kind: "empty" });
			toggleHasSuggestions();
			return out;
		}

		TimelineSearchModal.sessionLastNonEmptyQuery = qTrim;
		this.effectiveQuery = qTrim;

		try {
			pushTopRecords(qTrim, TimelineSearchModal.MAX_SUGGESTIONS);
		} catch {
			// ignore
		}
		// Always append an explicit "(Filter)" action for non-empty input.
		out.push({ kind: "filter", query: qTrim });
		// Always append an explicit "(Clear)" action at the end.
		out.push({ kind: "empty" });
		toggleHasSuggestions();
		return out;
	}

	renderSuggestion(value: TimelineSearchSuggestion, el: HTMLElement): void {
		if (!value || typeof value !== "object") {
			el.setText("(clear)");
			return;
		}
		if ((value as any).kind === "empty") {
			el.setText("(clear)");
			return;
		}
		if ((value as any).kind === "record") {
			const entry = ((value as any)?.entry ?? null) as DateEntry | null;
			const label = String((value as any).label ?? (entry as any)?.file ?? "");
			const filePath = String((entry as any)?.file ?? "");
			const summary = String((entry as any)?.summary ?? "").trim();
			const effectiveSummary = summary;

			let title = label;
			let meta = "";
			let dirOnly = "";
			if (filePath && filePath.includes("/")) {
				const lastSlash = filePath.lastIndexOf("/");
				const dir = lastSlash > 0 ? filePath.slice(0, lastSlash) : "";
				let base = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
				if (base.toLowerCase().endsWith(".md")) base = base.slice(0, -3);
				title = base || label;
				dirOnly = dir;
			}
			const cleanedSummary = effectiveSummary.replace(/\s+/g, " ").trim();
			const summaryMax = 180;
			const summaryShort = cleanedSummary.length > summaryMax ? `${cleanedSummary.slice(0, summaryMax - 1)}…` : cleanedSummary;
			if (dirOnly) meta = dirOnly;
			if (summaryShort) meta = meta ? `${meta} ${SUMMARY_SEPARATOR_SYMBOL} ${summaryShort}` : summaryShort;
			if (!meta && label && label !== title) meta = label;

			try {
				(el as any).textContent = "";
				el.addClass("epoch-timeline-search-match");
				const titleEl = (globalThis as any)?.document?.createElement?.("div") as HTMLElement | null;
				if (!titleEl) {
					(el as any).setText?.(title);
					return;
				}
				titleEl.addClass("epoch-timeline-search-match-title");
				titleEl.textContent = title;
				el.appendChild(titleEl);
				if (meta) {
					const metaEl = (globalThis as any).document.createElement("small");
					metaEl.addClass("epoch-timeline-search-match-meta");
					try {
						setCssStyles(metaEl as any, { fontSize: "0.7em", lineHeight: "1.15" });
					} catch {}
					metaEl.textContent = meta;
					el.appendChild(metaEl);
				}
			} catch {
				try {
					(el as any).setText?.(title);
				} catch {}
			}
			return;
		}
		if ((value as any).kind === "filter") {
			const q = String((value as any).query ?? "").trim();
			el.setText(q ? `(Filter ${q})` : "(Filter)");
			return;
		}
		el.setText("(clear)");
	}

	onChooseSuggestion(value: TimelineSearchSuggestion, _evt: MouseEvent | KeyboardEvent): void {
		if (!value || typeof value !== "object") {
			return;
		}
		if ((value as any).kind === "empty") {
			const v = "";
			try {
				this.latestQuery = v;
				this.effectiveQuery = v;
				TimelineSearchModal.sessionLastNonEmptyQuery = "";
				try {
					this.inputEl.value = v;
				} catch {}
				this.onCommit?.(v);
			} catch {}
			this.committed = true;
			this.close();
			return;
		}
		if ((value as any).kind === "record") {
			const entry = ((value as any).entry ?? null) as DateEntry | null;
			if (!entry) return;
			const q = String(this.effectiveQuery || this.latestQuery || "");
			try {
				this.onChooseRecord?.(entry, q);
			} catch {}
			this.committed = true;
			this.close();
			return;
		}
		if ((value as any).kind === "filter") {
			const q = String((value as any).query ?? this.latestQuery ?? "");
			try {
				this.latestQuery = q;
				this.effectiveQuery = q;
				TimelineSearchModal.sessionLastNonEmptyQuery = q.trim();
				this.onCommit?.(q);
			} catch {}
			this.committed = true;
			this.close();
			return;
		}
	}
}
