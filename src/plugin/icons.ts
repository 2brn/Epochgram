import { addIcon } from "obsidian";

import { EPOCHGRAM_LOGO_ICON } from "./epochgramLogoSvg";

export const AI_BRIDGE_GLYPH = "⌀";

// --- Other icons --- //

const HIGHLIGHTER_OFF_ICON = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
	<path d="M9 9 3 15v5h5l6-6" />
	<path d="m13.5 6.5 5.5-5.5 4.5 4.5-5.5 5.5" />
	<path d="M2 2l20 20" />
</svg>
`;

const PIN_FILL_ICON = `
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon lucide-pin"><path d="M12 17v5"></path><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"></path></svg>
`;

export interface IconMethods {
	registerCustomIcons(): void;
}

export const iconMethods: IconMethods = {
	registerCustomIcons() {
		addIcon("highlighter-off", HIGHLIGHTER_OFF_ICON);
		addIcon("pin-fill", PIN_FILL_ICON);
		addIcon("epochgram-logo", EPOCHGRAM_LOGO_ICON);
	}
};

