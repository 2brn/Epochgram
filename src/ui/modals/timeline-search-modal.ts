import { App, Platform, SuggestModal } from "obsidian";
import type { DateEntry } from "../../indexer/types";
import { SUMMARY_SEPARATOR_SYMBOL } from "../epoch-canvas-constants";
import { setCssStyles } from "../../dom";

const activeDocument = typeof window !== "undefined" ? window.document : ({} as Document);

type FocusableElement = HTMLElement & {
	focus(options?: FocusOptions): void;
};

type SuggestChooserLike = {
	selectedItem?: number;
	values?: TimelineSearchSuggestion[];
};

type InputChangedLike = {
	onInputChanged?: () => void;
};

type SearchMatchLike = {
	entry?: DateEntry;
	label?: string;
};

function toFocusableElement(value: Element | null): FocusableElement | null {
	return value && typeof (value as { focus?: unknown }).focus === "function"
		? (value as FocusableElement)
		: null;
}

function getChooser(modal: SuggestModal<TimelineSearchSuggestion>): SuggestChooserLike | null {
	return (modal as unknown as { chooser?: SuggestChooserLike }).chooser ?? null;
}

function getInputChangedHandle(modal: SuggestModal<TimelineSearchSuggestion>): InputChangedLike {
	return modal as unknown as InputChangedLike;
}

function getDocument(): Document | null {
	return window.document ?? null;
}


export type TimelineSearchSuggestion =
	| { kind: "empty" }
	| { kind: "filter"; query: string }
	| { kind: "record"; entry: DateEntry; label: string };

export class TimelineSearchModal extends SuggestModal<TimelineSearchSuggestion> {
	private static readonly MAX_SUGGESTIONS = 7;
	private static sessionLastNonEmptyQuery = "";
	private maxSuggestions: number;

	private titleText: string;
	private initialValue: string;
	private onCommit: ((value: string) => void) | null;
	private getTopMatches: ((query: string, max: number) => Array<{ entry: DateEntry; label?: string }>) | null;
	private onChooseRecord: ((entry: DateEntry, query: string, ev?: MouseEvent | KeyboardEvent) => void) | null;
	private latestQuery = "";
	private effectiveQuery = "";
	private priorActiveElement: HTMLElement | null = null;
	private handleInput: () => void;
	private handleKeyDown: (evt: KeyboardEvent) => void;
	private handleWindowKeyDown: (evt: KeyboardEvent) => void;
	private handleWindowKeyUp: (evt: KeyboardEvent) => void;
	private committed = false;
	private newTabModifierActive = false;

	constructor(
		app: App,
		options: {
			title?: string;
			initial: string;
			maxSuggestions?: number;
			onCommit?: (value: string) => void;
			getTopMatches?: (query: string, max: number) => Array<{ entry: DateEntry; label?: string }>;
		onChooseRecord?: (entry: DateEntry, query: string, ev?: MouseEvent | KeyboardEvent) => void;
		}
	) {
		super(app);
		this.priorActiveElement = typeof activeDocument !== "undefined"
			? toFocusableElement(activeDocument.activeElement)
			: null;
		this.titleText = String(options?.title ?? "Search");
		this.initialValue = String(options?.initial ?? "");
		const configuredMax = Math.floor(Number(options?.maxSuggestions ?? TimelineSearchModal.MAX_SUGGESTIONS));
		this.maxSuggestions = Number.isFinite(configuredMax) && configuredMax > 0
			? configuredMax
			: TimelineSearchModal.MAX_SUGGESTIONS;
		this.onCommit = typeof options?.onCommit === "function" ? options.onCommit : null;
		this.getTopMatches = typeof options?.getTopMatches === "function" ? options.getTopMatches : null;
		this.onChooseRecord = typeof options?.onChooseRecord === "function" ? options.onChooseRecord : null;
		this.setPlaceholder("Search timeline...");
		const filterKeyLabel = Platform.isMacOS ? "opt" : "alt";
		const newTabKeyLabel = Platform.isMacOS ? "cmd" : "ctrl";
		const instructions = [
			{ command: "\"exact\"", purpose: "" },
			{ command: "$marked", purpose: "" },
			{ command: "$hidden", purpose: "" },
			{ command: "$similar", purpose: "" },
			{ command: "↵", purpose: "to open" },
			{ command: `${newTabKeyLabel} ↵`, purpose: "to open in new tab" },
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
			} catch { void 0; }
			try {
				getInputChangedHandle(this).onInputChanged?.();
			} catch { void 0; }
		};
		this.handleKeyDown = (evt: KeyboardEvent) => {
			try {
				if (!evt) return;
				if (evt.key !== "Enter") return;
				if (evt.ctrlKey || evt.metaKey) {
					evt.preventDefault?.();
					evt.stopPropagation?.();
					const chooser = getChooser(this);
					const selectedIndex = typeof chooser?.selectedItem === "number" ? chooser.selectedItem : -1;
					const chosenValues = chooser?.values ?? null;
					const selectedValue =
						selectedIndex >= 0 && Array.isArray(chosenValues) && selectedIndex < chosenValues.length
							? chosenValues[selectedIndex]
							: null;
					const fallback = this.getSuggestions(String(this.latestQuery || "")).find((s) => s.kind === "record") ?? null;
					const picked = selectedValue?.kind === "record" ? selectedValue : fallback;
					if (picked && picked.kind === "record") {
						this.onChooseSuggestion(picked, evt);
					}
					return;
				}
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
		this.handleWindowKeyDown = (evt: KeyboardEvent) => {
			try {
				if (!evt) return;
				if (evt.ctrlKey || evt.metaKey || evt.key === "Control" || evt.key === "Meta") {
					this.newTabModifierActive = true;
				}
			} catch {
				// ignore
			}
		};
		this.handleWindowKeyUp = (evt: KeyboardEvent) => {
			try {
				if (!evt) return;
				if (evt.key === "Control" || evt.key === "Meta" || (!evt.ctrlKey && !evt.metaKey)) {
					this.newTabModifierActive = false;
				}
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
		this.newTabModifierActive = false;
		window.addEventListener("keydown", this.handleWindowKeyDown);
		window.addEventListener("keyup", this.handleWindowKeyUp);

		window.setTimeout(() => {
			try {
				this.inputEl.focus();
				const n = String(this.inputEl.value || "").length;
				this.inputEl.setSelectionRange(n, n);
			} catch { void 0; }
		}, 0);

		// Emit once to ensure the UI is in sync with the prefilled value.
		try {
			getInputChangedHandle(this).onInputChanged?.();
		} catch { void 0; }
	}

	onClose() {
		this.inputEl.removeEventListener("input", this.handleInput);
		this.inputEl.removeEventListener("keydown", this.handleKeyDown);
		window.removeEventListener("keydown", this.handleWindowKeyDown);
		window.removeEventListener("keyup", this.handleWindowKeyUp);
		this.newTabModifierActive = false;
		void super.onClose();
		if (Platform.isMobile) {
			this.priorActiveElement = null;
			return;
		}
		const el = this.priorActiveElement;
		this.priorActiveElement = null;
		if (el && typeof el.focus === "function") {
			try {
				(el as FocusableElement).focus({ preventScroll: true });
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
					const match = m as SearchMatchLike;
					const entry = match.entry ?? null;
					if (!entry) continue;
					const p = String(entry.file ?? "");
					if (!p) continue;
					if (seenFiles.has(p)) continue;
					seenFiles.add(p);
					const label = String(match.label ?? p);
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
			} catch { void 0; }
		};

		if (!qTrim) {
			// If the user cleared a previously-non-empty query (e.g., backspace),
			// treat this as an explicit reset back to the default suggestions.
			if (prevLatestTrim) {
				TimelineSearchModal.sessionLastNonEmptyQuery = "";
			}
			this.effectiveQuery = "";
			pushTopRecords("", this.maxSuggestions);
			out.push({ kind: "empty" });
			toggleHasSuggestions();
			return out;
		}

		TimelineSearchModal.sessionLastNonEmptyQuery = qTrim;
		this.effectiveQuery = qTrim;

		try {
			pushTopRecords(qTrim, this.maxSuggestions);
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
			el.setText("(Clear)");
			return;
		}
		if (value.kind === "empty") {
			el.setText("(Clear)");
			return;
		}
		if (value.kind === "record") {
			const entry = value.entry ?? null;
			const label = String(value.label ?? entry?.file ?? "");
			const filePath = String(entry?.file ?? "");
			const summary = String(entry?.summary ?? "").trim();
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
				el.textContent = "";
				el.addClass("epoch-timeline-search-match");
				const titleEl = getDocument()?.createElement("div") ?? null;
				if (!titleEl) {
					el.setText(title);
					return;
				}
				titleEl.addClass("epoch-timeline-search-match-title");
				titleEl.textContent = title;
				el.appendChild(titleEl);
				if (meta) {
					const metaEl = getDocument()?.createElement("small");
					if (!metaEl) return;
					metaEl.addClass("epoch-timeline-search-match-meta");
					try {
						setCssStyles(metaEl, { fontSize: "0.7em", lineHeight: "1.15" });
					} catch { void 0; }
					metaEl.textContent = meta;
					el.appendChild(metaEl);
				}
			} catch {
				try {
					el.setText(title);
				} catch { void 0; }
			}
			return;
		}
		if (value.kind === "filter") {
			const q = String(value.query ?? "").trim();
			el.setText(q ? `(Filter ${q})` : "(Filter)");
			return;
		}
		el.setText("(Clear)");
	}

	onChooseSuggestion(value: TimelineSearchSuggestion, _evt: MouseEvent | KeyboardEvent): void {
		if (!value || typeof value !== "object") {
			return;
		}
		if (value.kind === "empty") {
			const v = "";
			try {
				this.latestQuery = v;
				this.effectiveQuery = v;
				TimelineSearchModal.sessionLastNonEmptyQuery = "";
				try {
					this.inputEl.value = v;
				} catch { void 0; }
				this.onCommit?.(v);
			} catch { void 0; }
			this.committed = true;
			this.close();
			return;
		}
		if (value.kind === "record") {
			const entry = value.entry ?? null;
			if (!entry) return;
			const q = String(this.effectiveQuery || this.latestQuery || "");
			const hasNewTabModifier =
				!!(_evt.ctrlKey || _evt.metaKey) ||
				this.newTabModifierActive;
			const eventForOpen: MouseEvent | KeyboardEvent | undefined = hasNewTabModifier
				? (_evt.ctrlKey != null || _evt.metaKey != null
					? _evt
					: ({
						ctrlKey: !Platform.isMacOS,
						metaKey: Platform.isMacOS
					} as MouseEvent))
				: _evt;
			try {
				this.onChooseRecord?.(entry, q, eventForOpen);
			} catch { void 0; }
			this.committed = true;
			this.close();
			return;
		}
		if (value.kind === "filter") {
			const q = String(value.query ?? this.latestQuery ?? "");
			try {
				this.latestQuery = q;
				this.effectiveQuery = q;
				TimelineSearchModal.sessionLastNonEmptyQuery = q.trim();
				this.onCommit?.(q);
			} catch { void 0; }
			this.committed = true;
			this.close();
			return;
		}
	}
}
