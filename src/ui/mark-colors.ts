type RgbTriplet = readonly [number, number, number];

type ThemeRgbPair = {
	light: RgbTriplet;
	dark: RgbTriplet;
};

type CssVarRgbSource = {
	cssVar: `--${string}`;
	fallback: ThemeRgbPair;
};

type RgbSource = RgbTriplet | CssVarRgbSource;

type MarkColorGroupDef = {
	name: string;
	rgb: RgbSource;
	subitems: Array<{ name: string; rgb: RgbSource }>;
};

export type EpochMarkColorOption = {
	name: string;
	css: string;
	index: MarkColorIndex;
};

export type EpochMarkColorGroup = {
	name: string;
	base: EpochMarkColorOption;
	shades: EpochMarkColorOption[];
};

function rgbToHex(rgb: RgbTriplet): string {
	const toByte = (n: number): number => clamp(Math.round(Number(n) || 0), 0, 255);
	const toHex = (n: number): string => toByte(n).toString(16).padStart(2, "0");
	return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
}

function parseRgbTriplet(s: string): RgbTriplet | null {
	const raw = String(s || "").trim();
	if (!raw) return null;
	const parts = raw
		.split(/[^0-9.]+/g)
		.map((p) => p.trim())
		.filter(Boolean)
		.slice(0, 3);
	if (parts.length !== 3) return null;
	const nums = parts.map((p) => Number(p));
	if (nums.some((n) => !Number.isFinite(n))) return null;
	return [nums[0], nums[1], nums[2]] as const;
}

function isCssVarRgbSource(v: RgbSource): v is CssVarRgbSource {
	return typeof v === "object" && v != null && "cssVar" in v;
}

function isThemeDark(root: unknown): boolean {
	try {
		const doc = (root as any)?.ownerDocument;
		return Boolean(doc?.body?.classList?.contains?.("theme-dark"));
	} catch {
		return false;
	}
}

function resolveRgbTriplet(root: unknown, src: RgbSource): RgbTriplet {
	if (!isCssVarRgbSource(src)) return src;
	try {
		const doc = (root as any)?.ownerDocument;
		const win = doc?.defaultView;
		const el = root as any;
		if (win?.getComputedStyle && el) {
			const style = win.getComputedStyle(el);
			const raw = style?.getPropertyValue?.(src.cssVar)?.trim?.() ?? "";
			const parsed = parseRgbTriplet(raw);
			if (parsed) return parsed;
		}
	} catch {
		// ignore
	}
	return isThemeDark(root) ? src.fallback.dark : src.fallback.light;
}

const MARK_COLOR_VAR_NAMES: CssVarRgbSource["cssVar"][] = [
	"--color-red-rgb",
	"--color-orange-rgb",
	"--color-yellow-rgb",
	"--color-green-rgb",
	"--color-cyan-rgb",
	"--color-blue-rgb",
	"--color-purple-rgb",
	"--color-pink-rgb"
];

const DEFAULT_MARK_GROUPS_DEF: MarkColorGroupDef[] = [
	{
		name: "Red",
		rgb: {
			cssVar: "--color-red-rgb",
			fallback: {
				light: [233, 49, 71],
				dark: [251, 70, 76]
			}
		},
		subitems: [
			{ name: "Pomegranate", rgb: [176, 56, 76] },
			{ name: "Ruby", rgb: [174, 37, 34] },
			{
				name: "Red",
				rgb: {
					cssVar: "--color-red-rgb",
					fallback: {
						light: [233, 49, 71],
						dark: [251, 70, 76]
					}
				}
			},
			{ name: "Candy Apple", rgb: [224, 45, 37] },
			{ name: "Raspberry", rgb: [236, 74, 109] },
			{ name: "Red-Orange", rgb: [248, 103, 7] },
		]
	},
	{
		name: "Orange",
		rgb: {
			cssVar: "--color-orange-rgb",
			fallback: {
				light: [236, 117, 0],
				dark: [233, 151, 63]
			}
		},
		subitems: [
			{
				name: "Orange",
				rgb: {
					cssVar: "--color-orange-rgb",
					fallback: {
						light: [236, 117, 0],
						dark: [233, 151, 63]
					}
				}
			},
			{ name: "Smoothie", rgb: [241, 122, 119] },
			{ name: "Goldrush", rgb: [220, 142, 59] },
			{ name: "Nectarine", rgb: [248, 156, 89] },
			{ name: "Peach", rgb: [249, 189, 171] },
		]
	},
	{
		name: "Yellow",
		rgb: {
			cssVar: "--color-yellow-rgb",
			fallback: {
				light: [224, 172, 0],
				dark: [224, 222, 113]
			}
		},
		subitems: [
			{ name: "Saffron", rgb: [213, 162, 51] },
			{ name: "Canary", rgb: [254, 214, 125] },
			{ name: "Yellow-Orange", rgb: [247, 203, 22] },
			{ name: "Lemon", rgb: [253, 226, 79] },
			{
				name: "Yellow",
				rgb: {
					cssVar: "--color-yellow-rgb",
					fallback: {
						light: [224, 172, 0],
						dark: [224, 222, 113]
					}
				}
			}
		]
	},
	{
		name: "Green",
		rgb: {
			cssVar: "--color-green-rgb",
			fallback: {
				light: [8, 185, 78],
				dark: [68, 207, 110]
			}
		},
		subitems: [
			{ name: "Clover", rgb: [0, 172, 84] },
			{ name: "Willow", rgb: [100, 188, 79] },
			{ name: "Sage", rgb: [161, 190, 163] },
			{
				name: "Green",
				rgb: {
					cssVar: "--color-green-rgb",
					fallback: {
						light: [8, 185, 78],
						dark: [68, 207, 110]
					}
				}
			},
			{ name: "Fern", rgb: [141, 147, 70] }
		]
	},
	{
		name: "Cyan",
		rgb: {
			cssVar: "--color-cyan-rgb",
			fallback: {
				light: [0, 191, 188],
				dark: [83, 223, 221]
			}
		},
		subitems: [
			{ name: "Peacock", rgb: [2, 105, 109] },
			{ name: "Emerald", rgb: [13, 174, 140] },
			{ name: "Lagoon", rgb: [28, 187, 182] },
			{
				name: "Cyan",
				rgb: {
					cssVar: "--color-cyan-rgb",
					fallback: {
						light: [0, 191, 188],
						dark: [83, 223, 221]
					}
				}
			},
			{ name: "Glacier", rgb: [158, 208, 203] },
		]
	},
	{
		name: "Blue",
		rgb: {
			cssVar: "--color-blue-rgb",
			fallback: {
				light: [8, 109, 221],
				dark: [2, 122, 255]
			}
		},
		subitems: [
			{ name: "Sapphire", rgb: [2, 71, 103] },
			{ name: "Bluebird", rgb: [2, 126, 187] },
			{
				name: "Blue",
				rgb: {
					cssVar: "--color-blue-rgb",
					fallback: {
						light: [8, 109, 221],
						dark: [2, 122, 255]
					}
				}
			},
			{ name: "Carolina", rgb: [126, 193, 234] },
		]
	},
	{
		name: "Purple",
		rgb: {
			cssVar: "--color-purple-rgb",
			fallback: {
				light: [120, 82, 238],
				dark: [168, 130, 255]
			}
		},
		subitems: [
			{ name: "Blue-Violet", rgb: [101, 2, 152] },
			{ name: "Pansy", rgb: [140, 89, 138] },
			{
				name: "Purple",
				rgb: {
					cssVar: "--color-purple-rgb",
					fallback: {
						light: [120, 82, 238],
						dark: [168, 130, 255]
					}
				}
			}
		]
	},
	{
		name: "Pink",
		rgb: {
			cssVar: "--color-pink-rgb",
			fallback: {
				light: [213, 57, 132],
				dark: [250, 153, 205]
			}
		},
		subitems: [
			{ name: "Red-Violet", rgb: [203, 2, 153] },
			{
				name: "Pink",
				rgb: {
					cssVar: "--color-pink-rgb",
					fallback: {
						light: [213, 57, 132],
						dark: [250, 153, 205]
					}
				}
			},
			{ name: "Thistle", rgb: [184, 108, 149] },
			{ name: "Lilac", rgb: [214, 180, 195] },
			{ name: "Ballerina", rgb: [252, 212, 210] }
		]
	}
];

function buildMarkGroups(root: unknown): { groups: EpochMarkColorGroup[]; palette: string[] } {
	let nextIndex = 1;
	const groups: EpochMarkColorGroup[] = [];
	for (const group of DEFAULT_MARK_GROUPS_DEF) {
		const baseRgb = resolveRgbTriplet(root, group.rgb);
		const base: EpochMarkColorOption = {
			name: group.name,
			css: rgbToHex(baseRgb),
			index: nextIndex++
		};
		const shades: EpochMarkColorOption[] = group.subitems.map((s) => {
			const rgb = resolveRgbTriplet(root, s.rgb);
			return {
				name: s.name,
				css: rgbToHex(rgb),
				index: nextIndex++
			};
		});
		groups.push({ name: group.name, base, shades });
	}
	const palette: string[] = groups.flatMap((g) => [g.base.css, ...g.shades.map((s) => s.css)]);
	return { groups, palette };
}

function countMaxMarkColors(): number {
	let total = 0;
	for (const g of DEFAULT_MARK_GROUPS_DEF) total += 1 + g.subitems.length;
	return total;
}

export const MAX_MARK_COLORS = countMaxMarkColors();

const BASE_COLOR_INDEX_ORDER: MarkColorIndex[] = (() => {
	let idx = 1;
	const out: MarkColorIndex[] = [];
	for (const g of DEFAULT_MARK_GROUPS_DEF) {
		out.push(idx);
		idx += 1 + g.subitems.length;
	}
	return out;
})();

type MarkColorCache = {
	key: string;
	groups: EpochMarkColorGroup[];
	palette: string[];
};

let cache: MarkColorCache | null = null;

function computeCacheKey(root: unknown): string {
	let varsPart = "";
	try {
		const doc = (root as any)?.ownerDocument;
		const win = doc?.defaultView;
		if (win?.getComputedStyle && root) {
			const style = win.getComputedStyle(root as any);
			varsPart = MARK_COLOR_VAR_NAMES.map((n) => style.getPropertyValue(n).trim()).join("|");
		}
	} catch {
		// ignore
	}
	return `${isThemeDark(root) ? "dark" : "light"}:${varsPart}`;
}

function getCachedMarkColors(root: unknown): { groups: EpochMarkColorGroup[]; palette: string[] } {
	const key = computeCacheKey(root);
	if (cache && cache.key === key) return { groups: cache.groups, palette: cache.palette };
	const built = buildMarkGroups(root);
	cache = { key, ...built };
	return built;
}

export type MarkColorIndex = number;

function clamp(n: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, n));
}

export function getEpochMarkColorSet(root: HTMLElement): string[] {
	const { palette } = getCachedMarkColors(root);
	return palette.slice();
}

export function getEpochMarkColorGroups(root: HTMLElement): EpochMarkColorGroup[] {
	const { groups } = getCachedMarkColors(root);
	return groups;
}

export function getEpochMarkBaseColorIndexOrder(): MarkColorIndex[] {
	return BASE_COLOR_INDEX_ORDER.slice();
}

export function pickDefaultMarkColorIndex(used: Set<MarkColorIndex>, current: unknown = null): MarkColorIndex {
	const cur = normalizeMarkColorIndex(current);
	for (const idx of getEpochMarkBaseColorIndexOrder()) {
		if (!used.has(idx)) return idx;
	}
	for (let c = 1; c <= MAX_MARK_COLORS; c++) {
		if (!used.has(c)) return c;
	}
	// All used: fall back to deterministic cycling.
	return nextMarkColorIndex(cur);
}

export function normalizeMarkColorIndex(n: unknown): MarkColorIndex | null {
	if (typeof n !== "number" || !Number.isFinite(n)) return null;
	const v = Math.floor(n);
	if (v >= 1 && v <= MAX_MARK_COLORS) return v as MarkColorIndex;
	return null;
}

export function getUsedMarkColorIndexSet(
	filesObj: unknown,
	excludePath?: string
): Set<MarkColorIndex> {
	const used = new Set<MarkColorIndex>();
	try {
		if (!filesObj || typeof filesObj !== "object") return used;
		for (const [p, data] of Object.entries(filesObj as any)) {
			if (excludePath && p === excludePath) continue;
			const anyD: any = data as any;
			const rawIdx: unknown = typeof anyD?.markColor === "number" ? anyD.markColor : null;
			const idx = normalizeMarkColorIndex(rawIdx);
			if (idx) used.add(idx);
		}
	} catch {
		// ignore
	}
	return used;
}

export function pickUniqueMarkColorIndex(used: Set<MarkColorIndex>, current: unknown = null): MarkColorIndex {
	const cur = normalizeMarkColorIndex(current);
	for (let c = 1; c <= MAX_MARK_COLORS; c++) {
		if (!used.has(c)) return c;
	}
	// All used (unlikely): fall back to deterministic cycling.
	return nextMarkColorIndex(cur);
}

export function pickUnusedMarkColorIndexOrNull(used: Set<MarkColorIndex>, _current: unknown = null): MarkColorIndex | null {
	for (let c = 1; c <= MAX_MARK_COLORS; c++) {
		if (!used.has(c)) return c;
	}
	return null;
}

export function markColorOrderPreferUnused(_current: unknown, _used: Set<MarkColorIndex>): MarkColorIndex[] {
	// Stable order: 1..MAX_MARK_COLORS.
	const out: MarkColorIndex[] = [];
	for (let c = 1; c <= MAX_MARK_COLORS; c++) out.push(c);
	return out;
}

export function nextMarkColorIndex(current: unknown): MarkColorIndex {
	const cur = normalizeMarkColorIndex(current);
	return cur == null ? 1 : ((cur % MAX_MARK_COLORS) + 1);
}
