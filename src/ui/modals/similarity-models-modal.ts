import { Modal, Notice } from "obsidian";
import type { EpochPlugin } from "../../main";
import { DEFAULT_SIMILARITY_MODEL, DEFAULT_ZERO_SHOT_MODEL } from "../../plugin/similarity/config";
import { hasSimilarityAccess } from "../../plugin/pro-feature-state";
import { setCssStyles } from "../../dom";

type SimilarityModelsModalFocus = "semantics" | "topics";

export class SimilarityModelsModal extends Modal {
	private plugin: EpochPlugin;
	private focus: SimilarityModelsModalFocus;
	private inputEl: HTMLTextAreaElement | null = null;
	private submitted = false;

	constructor(app: any, plugin: EpochPlugin, options?: { focus?: SimilarityModelsModalFocus }) {
		super(app);
		this.plugin = plugin;
		this.focus = options?.focus === "topics" ? "topics" : "semantics";
	}

	onOpen(): void {
		this.modalEl.addClass("mod-file-rename");
		this.titleEl.setText("");
		this.contentEl.empty();

		const isPro = (() => {
			try {
				return hasSimilarityAccess(this.plugin);
			} catch {
				return false;
			}
		})();

		const currentEmbedding = String((this.plugin.settings as any)?.similarityEmbeddingModelId ?? "").trim();
		const currentZeroShot = String((this.plugin.settings as any)?.similarityZeroShotModelId ?? "").trim();

		const initialValue = this.focus === "topics" ? currentZeroShot : currentEmbedding;
		const placeholder = this.focus === "topics" ? DEFAULT_ZERO_SHOT_MODEL : DEFAULT_SIMILARITY_MODEL;

		const content = this.contentEl.createDiv({ cls: "modal-content" });
		const textarea = content.createEl("textarea", {
			cls: "rename-textarea",
			attr: { rows: 1, placeholder }
		});
		textarea.value = initialValue;
		textarea.toggleAttribute("disabled", !isPro);
		this.inputEl = textarea;

		const autoSize = () => {
			setCssStyles(textarea, { height: "auto" });
			textarea.style.height = `${textarea.scrollHeight}px`;
		};
		autoSize();
		textarea.addEventListener("input", autoSize);

		textarea.addEventListener("keydown", (event) => {
			if (event.key === "Enter" && !event.shiftKey) {
				event.preventDefault();
				void this.saveAndClose(currentEmbedding, currentZeroShot);
			}
			if (event.key === "Escape") {
				event.preventDefault();
				this.submitted = true;
				this.close();
			}
		});
		textarea.addEventListener("blur", () => {
			if (this.submitted) return;
			void this.saveAndClose(currentEmbedding, currentZeroShot);
		});

		window.requestAnimationFrame(() => {
			try {
				(textarea as any).focus?.({ preventScroll: true });
			} catch {
				textarea.focus();
			}
			textarea.setSelectionRange(0, textarea.value.length);
		});
	}

	private async saveAndClose(prevEmbedding: string, prevZeroShot: string): Promise<void> {
		if (this.submitted) return;
		this.submitted = true;
		const isPro = (() => {
			try {
				return hasSimilarityAccess(this.plugin);
			} catch {
				return false;
			}
		})();
		if (!isPro) {
			this.close();
			return;
		}

		try {
			if (this.focus === "topics") {
				const nextZeroShot = String(this.inputEl?.value ?? "").trim();
				const changedZeroShot = nextZeroShot !== prevZeroShot;
				if (!changedZeroShot) {
					this.close();
					return;
				}
				(this.plugin.settings as any).similarityZeroShotModelId = nextZeroShot ? nextZeroShot : undefined;
				await this.plugin.onSettingsChanged("similarityZeroShotModelId" as any);
				new Notice("Model updated.");
			} else {
				const nextEmbedding = String(this.inputEl?.value ?? "").trim();
				const changedEmbedding = nextEmbedding !== prevEmbedding;
				if (!changedEmbedding) {
					this.close();
					return;
				}
				(this.plugin.settings as any).similarityEmbeddingModelId = nextEmbedding ? nextEmbedding : undefined;
				await this.plugin.onSettingsChanged("similarityEmbeddingModelId" as any);
				new Notice("Model updated.");
			}
		} catch (e: any) {
			console.error("Failed to update similarity model", e);
			new Notice("Failed to update model (see console)");
		}

		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
		this.inputEl = null;
		this.modalEl.removeClass("mod-file-rename");
	}
}
