import { App, SuggestModal } from "obsidian";
import { canonicalizeTopicTerm, isNoTopicSentinel, sortTopicTermsIgnorePrefix } from "utils";
import { truncateToChars, truncateToWords } from "./text-utils";

type TopicSuggestItem =
	| { kind: "clear" }
	| { kind: "set"; term: string }
	| { kind: "remove"; term: string }
	;

export type TopicEditResult =
	| { action: "clear" }
	| { action: "set"; value: string }
	| { action: "remove-topic"; topic: string }
	;

class TopicSuggestModal extends SuggestModal<TopicSuggestItem> {
	private titleText: string;
	private initialValue: string;
	private maxWords: number;
	private maxChars: number;
	private topics: string[];
	private resolveChoice: (value: TopicEditResult | null) => void;
	private resolved = false;
	private handleKeyDown: (event: KeyboardEvent) => void;
	private handleInput: () => void;
	private priorActiveElement: HTMLElement | null = null;

	constructor(
		app: App,
		options: { title: string; initialValue: string; topics: string[]; maxWords: number; maxChars: number },
		resolve: (value: TopicEditResult | null) => void
	) {
		super(app);
		this.priorActiveElement = (typeof document !== "undefined" ? (document.activeElement as any) : null) as HTMLElement | null;
		this.titleText = options.title;
		this.initialValue = String(options.initialValue ?? "");
		this.topics = Array.isArray(options.topics)
			? options.topics
					.map((t) => canonicalizeTopicTerm(String(t).trim()))
					.filter((t) => !!t && !isNoTopicSentinel(t))
					.sort(sortTopicTermsIgnorePrefix)
			: [];
		this.maxWords = options.maxWords;
		this.maxChars = options.maxChars;
		this.resolveChoice = resolve;
		this.setPlaceholder("Select or type a topic");
		this.setInstructions([
			{ command: "↑↓", purpose: "to navigate" },
			{ command: "↵", purpose: "to choose" },
			{ command: "esc", purpose: "to dismiss" }
		]);
		this.handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Enter") return;
			const trimmed = String(this.inputEl.value || "").trim();
			const chooser: any = (this as any).chooser;
			const hasSelection = typeof chooser?.selectedItem === "number" && chooser.selectedItem >= 0;
			if (hasSelection) return;
			event.preventDefault();
			if (!trimmed) {
				this.finish({ action: "clear" });
				return;
			}
			const v0 = truncateToWords(truncateToChars(trimmed, this.maxChars), this.maxWords);
			const v = canonicalizeTopicTerm(v0);
			if (!v || isNoTopicSentinel(v)) {
				this.finish({ action: "clear" });
				return;
			}
			this.finish({ action: "set", value: v });
		};
		this.handleInput = () => {
			try {
				(this as any).onInputChanged?.();
			} catch {}
		};
	}

	onOpen() {
		void super.onOpen();
		this.titleEl.setText(this.titleText);
		this.inputEl.value = this.initialValue;
		this.inputEl.dispatchEvent(new Event("input"));
		this.inputEl.addEventListener("keydown", this.handleKeyDown);
		this.inputEl.addEventListener("input", this.handleInput);
	}

	onClose() {
		this.inputEl.removeEventListener("keydown", this.handleKeyDown);
		this.inputEl.removeEventListener("input", this.handleInput);
		void super.onClose();
		const el = this.priorActiveElement;
		this.priorActiveElement = null;
		if (el && typeof el.focus === "function") {
			window.requestAnimationFrame(() => {
				try {
					(el as any).focus?.({ preventScroll: true });
				} catch {
					try {
						el.focus();
					} catch {}
				}
			});
		}
	}

	getSuggestions(query: string): TopicSuggestItem[] {
		const typed = String(query || "").trim();
		const typedCanon = canonicalizeTopicTerm(typed);
		const normalized = typedCanon.toLowerCase();
		const out: TopicSuggestItem[] = [];
		const seenSet = new Set<string>();

		if (!typed) {
			out.push({ kind: "clear" });

			const current = String(this.initialValue || "").trim();
			const currentCanon = canonicalizeTopicTerm(current);
			const currentKey = currentCanon.toLowerCase();
			if (currentCanon && !isNoTopicSentinel(currentCanon)) {
				out.push({ kind: "remove", term: currentCanon });
			}
			const seenRemove = new Set<string>();
			if (current) seenRemove.add(currentKey);
			for (const t of this.topics) {
				const clean = String(t || "").trim();
				if (!clean) continue;
				if (isNoTopicSentinel(clean)) continue;
				const key = clean.toLowerCase();
				if (seenRemove.has(key)) continue;
				seenRemove.add(key);
				out.push({ kind: "remove", term: clean });
			}
			return out;
		}

		if (typedCanon && !isNoTopicSentinel(typedCanon)) {
			out.push({ kind: "set", term: typedCanon });
			seenSet.add(normalized);
		}

		const base = !normalized ? this.topics : this.topics.filter((t) => t.toLowerCase().includes(normalized));
		for (const t of base) {
			const clean = String(t || "").trim();
			if (!clean) continue;
			if (isNoTopicSentinel(clean)) continue;
			const key = clean.toLowerCase();
			if (seenSet.has(key)) continue;
			seenSet.add(key);
			out.push({ kind: "set", term: clean });
		}

		return out;
	}

	renderSuggestion(item: TopicSuggestItem, el: HTMLElement) {
		if (!item) {
			el.setText("");
			return;
		}
		if (item.kind === "clear") {
			el.setText("(no topic)");
			return;
		}
		if (item.kind === "remove") {
			const t = String(item.term || "").trim();
			el.setText(t ? `(remove ${t})` : "(remove topic)");
			return;
		}
		const v = String(item.term ?? "").trim();
		el.setText(v || "");
	}

	onChooseSuggestion(item: TopicSuggestItem) {
		if (!item) return;
		if (item.kind === "clear") {
			this.finish({ action: "clear" });
			return;
		}
		if (item.kind === "remove") {
			const term = String(item.term || "").trim();
			if (!term) return;
			this.finish({ action: "remove-topic", topic: term });
			return;
		}
		const v0 = String(item.term || "").trim();
		if (!v0 || isNoTopicSentinel(v0)) {
			this.finish({ action: "clear" });
			return;
		}
		const v1 = truncateToWords(truncateToChars(v0, this.maxChars), this.maxWords);
		const v = canonicalizeTopicTerm(v1);
		if (!v || isNoTopicSentinel(v)) {
			this.finish({ action: "clear" });
			return;
		}
		this.finish({ action: "set", value: v });
	}

	private finish(value: TopicEditResult) {
		if (this.resolved) return;
		this.resolved = true;
		this.resolveChoice(value);
		this.close();
	}
}

export function promptEditTopic(
	app: App,
	options: { title?: string; initialValue: string; topics: string[]; maxWords?: number; maxChars?: number }
): Promise<TopicEditResult | null> {
	return new Promise((resolve) => {
		const modal = new TopicSuggestModal(
			app,
			{
				title: options.title ?? "Edit topic",
				initialValue: options.initialValue,
				topics: options.topics,
				maxWords: options.maxWords ?? 12,
				maxChars: options.maxChars ?? 140
			},
			resolve
		);
		modal.open();
	});
}
