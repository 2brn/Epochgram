import { ItemView, MarkdownRenderer, WorkspaceLeaf } from "obsidian";
import type { EpochPlugin } from "../main";
import { normalizeWhatsNewMarkdownAssets, setWhatsNewOptOut } from "../plugin/whats-new";
import { VIEW_TYPE_WHATS_NEW } from "./whats-new-view-mode";

type WhatsNewLeafState = {
	version?: string;
	markdown?: string;
};

const WHATS_NEW_FOOTER = [
	"---",
	"",
	"## Need help?",
    "",
	"Documentation: https://www.epochgram.com/docs",
	"Report a bug: https://github.com/2brn/Epochgram/issues",
    "Contact: hi@epochgram.com",
     "",
    "Thanks for using Epochgram ❤️"
].join("\n");

export class WhatsNewView extends ItemView {
	private plugin: EpochPlugin;
	private readonly optOutLabel = "Don't show this page again";
	private currentState: Required<WhatsNewLeafState> = { version: "", markdown: "" };

	constructor(leaf: WorkspaceLeaf, plugin: EpochPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_WHATS_NEW;
	}

	getDisplayText(): string {
		return "Epochgram: What's New";
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("markdown-reading-view");
		this.contentEl.addClass("epoch-whats-new-view");
		await this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.removeClass("markdown-reading-view");
		this.contentEl.removeClass("epoch-whats-new-view");
		this.contentEl.empty();
	}

	async setState(state: unknown, _result: unknown): Promise<void> {
		const next = (state ?? {}) as WhatsNewLeafState;
		this.currentState = {
			version: String(next.version ?? "").trim(),
			markdown: String(next.markdown ?? "")
		};
		await this.render();
	}

	getState(): WhatsNewLeafState {
		return {
			version: this.currentState.version,
			markdown: this.currentState.markdown
		};
	}

	private buildMarkdown(version: string, body: string): string {
		const checked = this.plugin.settings.whatsNewOptOut === true ? "x" : " ";
		const safeBody = String(body || "").replace(/\r\n?/g, "\n").trim();
		return `- [${checked}] ${this.optOutLabel}\n\n\n\n${safeBody}\n\n${WHATS_NEW_FOOTER}\n\n---\n`;
	}

	private readLeafState(): Required<WhatsNewLeafState> {
		const fromLeaf = (this.leaf.getViewState()?.state ?? {}) as WhatsNewLeafState;
		const version = String(fromLeaf.version ?? this.currentState.version ?? "").trim();
		const markdown = String(fromLeaf.markdown ?? this.currentState.markdown ?? "");
		return { version, markdown };
	}

	private async render(): Promise<void> {
		const { version, markdown } = this.readLeafState();
		const root = this.contentEl;
		root.empty();
		const preview = root.createDiv({
			cls: "markdown-preview-view markdown-rendered node-insert-event is-readable-line-width allow-fold-headings allow-fold-lists show-indentation-guide"
		});
		preview.tabIndex = -1;
		const container = preview.createDiv({ cls: "markdown-preview-sizer markdown-preview-section" });
		container.createDiv({ cls: "markdown-preview-pusher" });
		const header = container.createDiv({ cls: "mod-header mod-ui" });
		header.createDiv({
			cls: "inline-title",
			text: version ? `What's New in Epochgram ${version}` : "What's New in Epochgram"
		});
		const body = container.createDiv({ cls: "epoch-whats-new-body" });
		const normalizedMarkdown = normalizeWhatsNewMarkdownAssets(this.plugin, markdown);
		const rendered = this.buildMarkdown(version, normalizedMarkdown);
		await MarkdownRenderer.render(this.app, rendered, body, "", this);

		const input = body.querySelector<HTMLInputElement>("input[type=checkbox]");
		if (input) {
			input.checked = this.plugin.settings.whatsNewOptOut === true;
			input.addEventListener("change", () => {
				void setWhatsNewOptOut(this.plugin, input.checked);
			});
		}
	}
}
