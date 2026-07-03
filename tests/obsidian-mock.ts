export class TFile {
	path: string;
	basename: string;
	extension: string;
	stat: { ctime: number; mtime: number; size: number };

	constructor(path: string, options: Partial<TFile> = {}) {
		this.path = path;
		this.basename = options.basename ?? path;
		this.extension = options.extension ?? "md";
		this.stat = options.stat ?? { ctime: Date.now(), mtime: Date.now(), size: 0 };
	}
}

export class TAbstractFile {
	path: string;

	constructor(path: string) {
		this.path = path;
	}
}

export class TFolder {
	path: string;

	constructor(path: string) {
		this.path = path;
	}
}

export class MarkdownView {}

export class ItemView {
	leaf: WorkspaceLeaf;
	app: App;
	contentEl: any;

	constructor(leaf: WorkspaceLeaf) {
		this.leaf = leaf;
		this.app = (leaf as any)?.app ?? new App();
		this.contentEl = {
			createDiv() {
				return {
					createDiv() {
						return {};
					}
				};
			},
			empty() {}
		};
	}

	registerDomEvent(_el: any, _event: string, _cb: any, _options?: any): void {
		// no-op
	}

	registerEvent(_ref: any): void {
		// no-op
	}
}

export class WorkspaceLeaf {
	view: any;
	parent: any;
	app: any;

	constructor(view: any = new MarkdownView()) {
		this.view = view;
		this.parent = {};
		this.app = new App();
	}

	async openFile(_file: any): Promise<void> {
		// no-op
	}
}

export class App {
	vault: any;
	workspace: any;

	constructor() {
		this.vault = {};
		this.workspace = {};
	}
}

export class Modal {
	app: App;
	containerEl: any;
	contentEl: any;

	constructor(app: App) {
		this.app = app;
		this.containerEl = {};
		this.contentEl = {};
	}

	open(): void {
		// no-op
	}

	close(): void {
		// no-op
	}
}

export class SuggestModal<T> extends Modal {
	items: T[] = [];
	inputEl: any;
	titleEl: any;

	constructor(app: App) {
		super(app);
		this.inputEl = {
			value: "",
			addEventListener() {},
			removeEventListener() {},
			dispatchEvent() {}
		};
		this.titleEl = {
			setText() {}
		};
	}

	setPlaceholder(_text: string): void {
		// no-op
	}

	setInstructions(_items: Array<{ command: string; purpose: string }>): void {
		// no-op
	}

	onOpen(): void {
		// no-op
	}

	onClose(): void {
		// no-op
	}
}

export class PluginSettingTab {
	app: App;
	plugin: any;
	containerEl: any;

	constructor(app: App, plugin: any) {
		this.app = app;
		this.plugin = plugin;
		this.containerEl = {
			empty() {},
			createDiv() {
				return {
					createEl() {
						return {};
					}
				};
			}
		};
	}

	display(): void {
		// no-op
	}
}

export class Setting {
	constructor(_containerEl: any) {}
	setName(_name: string): this {
		return this;
	}
	setDesc(_desc: any): this {
		return this;
	}
	addButton(_cb: (btn: any) => any): this {
		_cb({
			setButtonText() {
				return this;
			},
			setWarning() {
				return this;
			},
			setCta() {
				return this;
			},
			onClick() {
				return this;
			}
		});
		return this;
	}
	addSlider(_cb: (slider: any) => any): this {
		_cb({
			setLimits() {
				return this;
			},
			setValue() {
				return this;
			},
			setDynamicTooltip() {
				return this;
			},
			onChange() {
				return this;
			}
		});
		return this;
	}
	addText(_cb: (text: any) => any): this {
		_cb({
			setPlaceholder() {
				return this;
			},
			setValue() {
				return this;
			},
			onChange() {
				return this;
			},
			inputEl: {
				addClass() {},
				setAttr() {}
			}
		});
		return this;
	}
}

export class Notice {
	message: string;

	constructor(message: string) {
		this.message = message;
	}
}

export const Platform = {
	isDesktop: true,
	isMobile: false
};

let requestUrlHandler: ((request: any) => unknown) | null = null;

export function __setRequestUrlHandler(handler: ((request: any) => unknown) | null): void {
	requestUrlHandler = handler;
}

export async function requestUrl(request: any): Promise<any> {
	if (!requestUrlHandler) {
		throw new Error("requestUrl handler not set");
	}
	return (await requestUrlHandler(request)) as any;
}

export async function request(requestArg: any): Promise<string> {
	const response = await requestUrl(requestArg);
	return String(response?.text ?? "");
}

export class MenuItem {
	title: string = "";
	icon: string = "";
	disabled: boolean = false;
	isLabel: boolean = false;
	onClickCb: (() => void) | null = null;
	submenu: Menu | null = null;

	setTitle(title: string): this {
		this.title = title;
		return this;
	}

	setIcon(icon: string | null): this {
		this.icon = typeof icon === "string" ? icon : "";
		return this;
	}

	setIsLabel(isLabel: boolean): this {
		this.isLabel = isLabel;
		return this;
	}

	setDisabled(disabled: boolean): this {
		this.disabled = disabled;
		return this;
	}

	onClick(cb: () => void): this {
		this.onClickCb = cb;
		return this;
	}

	setSubmenu(): Menu {
		this.submenu = new Menu();
		return this.submenu;
	}
}

export class Menu {
	items: Array<MenuItem | { kind: "separator" }> = [];
	private hideHandlers: Array<() => void> = [];

	addItem(cb: (item: MenuItem) => void): void {
		const item = new MenuItem();
		cb(item);
		this.items.push(item);
	}

	addSeparator(): void {
		this.items.push({ kind: "separator" });
	}

	onHide(cb: () => void): void {
		this.hideHandlers.push(cb);
	}

	showAtPosition(_pos: { x: number; y: number }): void {
		// no-op
	}

	hide(): void {
		for (const cb of this.hideHandlers) cb();
	}
}

export function setIcon(_el: any, _icon: string): void {
	// no-op
}

export function normalizePath(path: string): string {
	return String(path || "")
		.replace(/\\/g, "/")
		.replace(/\/{2,}/g, "/")
		.replace(/\/$/, "");
}
