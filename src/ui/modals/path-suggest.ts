import { AbstractInputSuggest, TFile, TFolder, type App } from "obsidian";
export class FolderPathSuggest extends AbstractInputSuggest<TFolder> {
	constructor(private appRef: App, private inputRef: HTMLInputElement) { super(appRef, inputRef); }
	getSuggestions(input: string): TFolder[] {
		return this.appRef.vault.getAllLoadedFiles().filter((file): file is TFolder => file instanceof TFolder && file.path.toLowerCase().includes(input.trim().toLowerCase())).sort((a, b) => a.path.localeCompare(b.path));
	}
	renderSuggestion(folder: TFolder, el: HTMLElement): void { el.setText(folder.path || "/"); }
	selectSuggestion(folder: TFolder): void { this.inputRef.value = folder.path; this.inputRef.dispatchEvent(new Event("input")); this.close(); }
}
export class FilePathSuggest extends AbstractInputSuggest<TFile> {
	constructor(private appRef: App, private inputRef: HTMLInputElement) { super(appRef, inputRef); }
	getSuggestions(input: string): TFile[] { return this.appRef.vault.getMarkdownFiles().filter(file => file.path.toLowerCase().includes(input.trim().toLowerCase())).sort((a, b) => a.path.localeCompare(b.path)); }
	renderSuggestion(file: TFile, el: HTMLElement): void { el.setText(file.path); }
	selectSuggestion(file: TFile): void { this.inputRef.value = file.path; this.inputRef.dispatchEvent(new Event("input")); this.close(); }
}
