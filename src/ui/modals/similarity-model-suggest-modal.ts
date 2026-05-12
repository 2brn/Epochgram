import { App, Notice, SuggestModal } from "obsidian";
import type { EpochPlugin } from "../../main";
import { DEFAULT_SIMILARITY_MODEL, DEFAULT_ZERO_SHOT_MODEL, NO_SIMILARITY_MODEL } from "../../plugin/similarity/config";
import { hasSimilarityAccess } from "../../plugin/pro-feature-state";

export type SimilarityModelSuggestFocus = "semantics" | "topics";

type ModelSuggestItem =
	| { kind: "none" }
	| { kind: "default"; modelId: string }
	| { kind: "typed"; modelId: string }
	| { kind: "suggested"; modelId: string }
	;

type Choice = { kind: "none" } | { kind: "default" } | { kind: "model"; modelId: string };

function getChosenModelId(choice: Choice, typedModelId: string, defaultModelId: string): string {
	if (choice.kind === "none") return "";
	if (choice.kind === "default") return defaultModelId;
	return String(typedModelId || "").trim();
}

function showModelDownloadNotice(kind: "semantics" | "topics", modelId: string): void {
	const normalized = String(modelId || "").trim();
	if (!normalized) return;
	const label = kind === "topics" ? "Topics" : "Semantics";
	new Notice(`${label} model downloading: ${normalized}`, 6000);
}

function normalizeModelAddress(inputRaw: string): string {
	return String(inputRaw || "").trim();
}

function isValidModelId(modelIdRaw: string): boolean {
	const modelId = String(modelIdRaw || "").trim();
	if (!modelId) return false;
	if (modelId.includes(" ") || modelId.includes("\t") || modelId.includes("\n") || modelId.includes("\r")) return false;
	if (modelId.includes(":")) return false;
	if (modelId.includes("@")) return false;
	if (modelId.startsWith("http://") || modelId.startsWith("https://")) return false;

	const parts = modelId.split("/").filter(Boolean);
	if (parts.length !== 2) return false;
	const [owner, name] = parts;
	const baseOk = /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(owner) && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name);
	if (!baseOk) return false;
	return true;
}


export class SimilarityModelSuggestModal extends SuggestModal<ModelSuggestItem> {
	private plugin: EpochPlugin;
	private focus: SimilarityModelSuggestFocus;
	private resolveDone: (() => void) | null;
	private resolved = false;
	private handleKeyDown: (event: KeyboardEvent) => void;
	private handleInput: () => void;
	private priorActiveElement: HTMLElement | null = null;
	private suggestions: string[];

	constructor(
		app: App,
		plugin: EpochPlugin,
		options: { focus: SimilarityModelSuggestFocus; onDone?: () => void }
	) {
		super(app);
		this.priorActiveElement = (typeof document !== "undefined" ? (document.activeElement as any) : null) as HTMLElement | null;
		this.plugin = plugin;
		this.focus = options.focus;
		this.resolveDone = typeof options.onDone === "function" ? options.onDone : null;
		this.suggestions = this.buildSuggestions();

		this.setPlaceholder("Type model ID (owner/model)");
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
				void this.applyChoice({ kind: "none" });
				return;
			}
			void this.applyChoice({ kind: "model", modelId: trimmed });
		};

		this.handleInput = () => {
			try {
				(this as any).onInputChanged?.();
			} catch {}
		};
	}

	onOpen() {
		void super.onOpen();
		this.titleEl.setText(this.focus === "topics" ? "Topics model" : "Semantics model");
		const currentOverride = this.getCurrentOverride();
		const defaultModelId = this.getDefaultModelId();
		const effectiveModelId = currentOverride === NO_SIMILARITY_MODEL
			? ""
			: (currentOverride ? currentOverride : defaultModelId);
		this.inputEl.value = effectiveModelId;
		this.inputEl.placeholder = defaultModelId;
		this.inputEl.dispatchEvent(new Event("input"));
		this.inputEl.addEventListener("keydown", this.handleKeyDown);
		this.inputEl.addEventListener("input", this.handleInput);
		window.requestAnimationFrame(() => {
			try {
				(this.inputEl as any).focus?.({ preventScroll: true });
			} catch {
				this.inputEl.focus();
			}
			try {
				this.inputEl.setSelectionRange(0, this.inputEl.value.length);
			} catch {}
		});
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

	getSuggestions(query: string): ModelSuggestItem[] {
		const trimmed = String(query || "").trim();
		const normalized = trimmed.toLowerCase();
		const defaultModelId = this.getDefaultModelId();

		// Rules:
		// - Empty input: show (No model), the default, and any other known suggestions.
		// - Any input: include a suggestion with the same text.
		if (!trimmed) {
			const items: ModelSuggestItem[] = [{ kind: "none" }, { kind: "default", modelId: defaultModelId }];
			const extras: string[] = [];
			for (const modelId of this.suggestions) {
				if (modelId !== defaultModelId) extras.push(modelId);
			}
			for (const modelId of extras.slice(0, 3)) {
				items.push({ kind: "suggested", modelId });
			}
			return items;
		}

		const out: ModelSuggestItem[] = [{ kind: "typed", modelId: trimmed }];
		for (const modelId of this.suggestions) {
			if (modelId.toLowerCase().includes(normalized) && modelId !== trimmed) {
				out.push({ kind: "suggested", modelId });
			}
		}
		return out;
	}

	renderSuggestion(item: ModelSuggestItem, el: HTMLElement) {
		if (item.kind === "none") {
			el.setText("(no model)");
			return;
		}
		if (item.kind === "default") {
			// Show only the model ID.
			el.setText(item.modelId);
			return;
		}
		if (item.kind === "typed") {
			el.setText(item.modelId);
			return;
		}
		el.setText(item.modelId);
	}

	onChooseSuggestion(item: ModelSuggestItem) {
		if (item.kind === "none") {
			void this.applyChoice({ kind: "none" });
			return;
		}
		if (item.kind === "default") {
			void this.applyChoice({ kind: "default" });
			return;
		}
		void this.applyChoice({ kind: "model", modelId: item.modelId });
	}

	private buildSuggestions(): string[] {
		const out: string[] = [];
		const add = (id: string) => {
			const trimmed = String(id || "").trim();
			if (!trimmed) return;
			if (!out.includes(trimmed)) out.push(trimmed);
		};

		add(this.getDefaultModelId());

		const current = this.getCurrentOverride();
		if (current && current !== NO_SIMILARITY_MODEL) add(current);

		if (this.focus === "semantics") {
			add("Xenova/bge-small-en-v1.5");
			add("Xenova/multilingual-e5-small");
		}

		if (this.focus === "topics") {
			add("Xenova/nli-deberta-v3-xsmall");
			add("Xenova/nli-deberta-v3-small");
			add("Xenova/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7");
		}

		return out;
	}

	private getDefaultModelId(): string {
		return this.focus === "topics" ? DEFAULT_ZERO_SHOT_MODEL : DEFAULT_SIMILARITY_MODEL;
	}

	private getCurrentOverride(): string {
		if (this.focus === "topics") {
			return String((this.plugin.settings as any)?.similarityZeroShotModelId ?? "").trim();
		}
		return String((this.plugin.settings as any)?.similarityEmbeddingModelId ?? "").trim();
	}

	private async applyChoice(choice: Choice): Promise<void> {
		let isPro = false;
		try {
			isPro = hasSimilarityAccess(this.plugin);
		} catch {
			isPro = false;
		}
		if (!isPro) {
			this.close();
			return;
		}

		let effectiveChoice: Choice = choice;
		let trimmed = choice.kind === "model" ? String(choice.modelId || "").trim() : "";
		let normalized = choice.kind === "model" ? normalizeModelAddress(trimmed) : "";
		if (choice.kind === "model" && !isValidModelId(normalized)) {
			new Notice("Invalid model ID.", 7000);
			effectiveChoice = { kind: "none" };
			trimmed = "";
			normalized = "";
		}

		if (this.resolved) return;
		this.resolved = true;
		try {
			if (this.focus === "topics") {
				await this.applyTopics(effectiveChoice, normalized);
			} else {
				await this.applySemantics(effectiveChoice, normalized);
			}
		} finally {
			try {
				this.resolveDone?.();
			} catch {}
			this.close();
		}
	}

	private async applySemantics(choice: Choice, trimmed: string): Promise<void> {
		const prevRaw = (this.plugin.settings as any)?.similarityEmbeddingModelId;
		const prev = typeof prevRaw === "string" ? prevRaw : "";
		const next = choice.kind === "none" ? NO_SIMILARITY_MODEL : (choice.kind === "default" ? "" : trimmed);
		if (prev === next) return;
		const chosenModelId = getChosenModelId(choice, trimmed, DEFAULT_SIMILARITY_MODEL);
		showModelDownloadNotice("semantics", chosenModelId);

		if (next) (this.plugin.settings as any).similarityEmbeddingModelId = next;
		else {
			if (Object.prototype.hasOwnProperty.call(this.plugin.settings as any, "similarityEmbeddingModelId")) {
				delete (this.plugin.settings as any).similarityEmbeddingModelId;
			}
		}
		await this.plugin.onSettingsChanged("similarityEmbeddingModelId");
	}

	private async applyTopics(choice: Choice, trimmed: string): Promise<void> {
		const prevRaw = (this.plugin.settings as any)?.similarityZeroShotModelId;
		const prev = typeof prevRaw === "string" ? prevRaw : "";
		const next = choice.kind === "none" ? NO_SIMILARITY_MODEL : (choice.kind === "default" ? "" : trimmed);
		if (prev === next) return;
		const chosenModelId = getChosenModelId(choice, trimmed, DEFAULT_ZERO_SHOT_MODEL);
		showModelDownloadNotice("topics", chosenModelId);

		if (next) (this.plugin.settings as any).similarityZeroShotModelId = next;
		else {
			if (Object.prototype.hasOwnProperty.call(this.plugin.settings as any, "similarityZeroShotModelId")) {
				delete (this.plugin.settings as any).similarityZeroShotModelId;
			}
		}
		await this.plugin.onSettingsChanged("similarityZeroShotModelId");
	}
}
