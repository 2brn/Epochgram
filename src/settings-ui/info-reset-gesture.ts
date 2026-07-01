import type { Setting } from "obsidian";

export function registerInfoResetGesture(
	setting: Setting,
	onReset: () => Promise<void> | void
): void {
	const infoEl = setting.settingEl?.querySelector?.<HTMLElement>(".setting-item-info") ?? null;
	if (!infoEl) return;
	infoEl.addEventListener("dblclick", (event) => {
		event.preventDefault();
		event.stopPropagation();
		void onReset();
	});
	let lastTapAt = 0;
	infoEl.addEventListener(
		"touchend",
		(event) => {
			const now = Date.now();
			if (now - lastTapAt > 0 && now - lastTapAt < 350) {
				lastTapAt = 0;
				event.preventDefault();
				event.stopPropagation();
				void onReset();
				return;
			}
			lastTapAt = now;
		},
		{ passive: false }
	);
}
