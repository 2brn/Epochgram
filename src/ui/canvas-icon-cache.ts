import { getIcon } from "obsidian";
import { setCssStyles } from "../dom";

const activeDocument = window.document;


type IconPathSpec = {
	path: Path2D;
	strokeWidth: number;
	hasStroke: boolean;
	hasFill: boolean;
};

type CachedIcon = {
	viewBox: { x: number; y: number; width: number; height: number };
	paths: IconPathSpec[];
	contentBounds: { x: number; y: number; width: number; height: number } | null;
	maxDimension: number;
};

function parseNumber(value: string | null, fallback: number): number {
	if (value == null || value.length === 0) return fallback;
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function hasFill(value: string | null | undefined): boolean {
	if (value == null) return false;
	const trimmed = value.trim();
	if (!trimmed) return false;
	return trimmed.toLowerCase() !== "none";
}

function hasStroke(width: number, color: string | null | undefined): boolean {
	if (!width || width <= 0) return false;
	if (color == null) return true;
	return color.trim().toLowerCase() !== "none";
}

function parseViewBox(svg: SVGElement): { x: number; y: number; width: number; height: number } {
	const attr = svg.getAttribute("viewBox");
	if (attr) {
		const parts = attr
			.trim()
			.split(/[\s,]+/)
			.map(v => Number.parseFloat(v))
			.filter(v => Number.isFinite(v));
		if (parts.length === 4) {
			return {
				x: parts[0],
				y: parts[1],
				width: parts[2],
				height: parts[3]
			};
		}
	}
	const widthAttr = parseNumber(svg.getAttribute("width"), 24);
	const heightAttr = parseNumber(svg.getAttribute("height"), 24);
	return { x: 0, y: 0, width: widthAttr || 24, height: heightAttr || 24 };
}

function parsePoints(points: string): Array<{ x: number; y: number }> {
	const values: number[] = [];
	for (const token of points.trim().split(/[\s,]+/)) {
		if (!token) continue;
		const parsed = Number.parseFloat(token);
		if (Number.isFinite(parsed)) {
			values.push(parsed);
		}
	}
	const out: Array<{ x: number; y: number }> = [];
	for (let i = 0; i + 1 < values.length; i += 2) {
		out.push({ x: values[i], y: values[i + 1] });
	}
	return out;
}

function ensureMeasureRoot(): SVGSVGElement {
	let root = activeDocument.querySelector("svg[data-epoch-measure-root]") as SVGSVGElement | null;
	if (root) return root;
	root = activeDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
	root.setAttribute("data-epoch-measure-root", "true");
	root.setAttribute("width", "0");
	root.setAttribute("height", "0");
	setCssStyles(root, {
		position: "absolute",
		visibility: "hidden",
		pointerEvents: "none",
		left: "-9999px",
		top: "-9999px",
		overflow: "visible"
	});
	activeDocument.body.appendChild(root);
	return root;
}

function measureIconBounds(svg: SVGElement): { x: number; y: number; width: number; height: number } | null {
	if (typeof (svg as any)?.getBBox !== "function") return null;
	try {
		const root = ensureMeasureRoot();
		const clone = svg.cloneNode(true) as SVGGraphicsElement;
		root.appendChild(clone);
		let bbox: DOMRect;
		try {
			bbox = clone.getBBox();
		} finally {
			root.removeChild(clone);
		}
		if (!Number.isFinite(bbox.width) || !Number.isFinite(bbox.height)) {
			return null;
		}
		return { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height };
	} catch (error) {
		void error;
		return null;
	}
}

function collectPaths(
	element: SVGElement,
	strokeWidth: number,
	fillColor: string | null | undefined,
	strokeColor: string | null | undefined,
	out: IconPathSpec[]
): void {
	const nextStrokeWidth = parseNumber(element.getAttribute("stroke-width"), strokeWidth);
	const ownStroke = element.getAttribute("stroke");
	const nextStrokeColor = ownStroke !== null ? ownStroke : strokeColor;
	const ownFill = element.getAttribute("fill");
	const nextFill = ownFill !== null ? ownFill : fillColor;
	const tag = element.tagName.toLowerCase();
	switch (tag) {
		case "path": {
			const d = element.getAttribute("d");
			if (!d) break;
			try {
				const path = new Path2D(d);
				out.push({
					path,
					strokeWidth: nextStrokeWidth,
					hasStroke: hasStroke(nextStrokeWidth, nextStrokeColor),
					hasFill: hasFill(nextFill)
				});
			} catch (error) {
				void error;
			}
			break;
		}
		case "line": {
			const x1 = parseNumber(element.getAttribute("x1"), 0);
			const y1 = parseNumber(element.getAttribute("y1"), 0);
			const x2 = parseNumber(element.getAttribute("x2"), 0);
			const y2 = parseNumber(element.getAttribute("y2"), 0);
			const path = new Path2D();
			path.moveTo(x1, y1);
			path.lineTo(x2, y2);
			out.push({
				path,
				strokeWidth: nextStrokeWidth,
				hasStroke: hasStroke(nextStrokeWidth, nextStrokeColor),
				hasFill: false
			});
			break;
		}
		case "polyline":
		case "polygon": {
			const pointSpec = element.getAttribute("points") ?? "";
			const points = parsePoints(pointSpec);
			if (points.length < 2) break;
			const path = new Path2D();
			path.moveTo(points[0].x, points[0].y);
			for (let i = 1; i < points.length; i++) {
				path.lineTo(points[i].x, points[i].y);
			}
			const isClosed = tag === "polygon";
			if (isClosed) {
				path.closePath();
			}
			out.push({
				path,
				strokeWidth: nextStrokeWidth,
				hasStroke: hasStroke(nextStrokeWidth, nextStrokeColor),
				hasFill: isClosed && hasFill(nextFill)
			});
			break;
		}
		case "rect": {
			const x = parseNumber(element.getAttribute("x"), 0);
			const y = parseNumber(element.getAttribute("y"), 0);
			const width = parseNumber(element.getAttribute("width"), 0);
			const height = parseNumber(element.getAttribute("height"), 0);
			if (width <= 0 || height <= 0) break;
			let rx = parseNumber(element.getAttribute("rx"), 0);
			let ry = parseNumber(element.getAttribute("ry"), rx);
			rx = Math.min(rx, width / 2);
			ry = Math.min(ry, height / 2);
			const path = new Path2D();
			if (rx <= 0 && ry <= 0) {
				path.rect(x, y, width, height);
			} else {
				const cornerRadius = Math.max(rx, ry);
				const roundRect = (path as any).roundRect as ((x: number, y: number, w: number, h: number, radii: number) => void) | undefined;
				if (typeof roundRect === "function") {
					roundRect.call(path, x, y, width, height, cornerRadius);
				} else {
					// Manual rounded rectangle fallback for environments lacking Path2D.roundRect
					const r = cornerRadius;
					path.moveTo(x + r, y);
					path.lineTo(x + width - r, y);
					path.quadraticCurveTo(x + width, y, x + width, y + r);
					path.lineTo(x + width, y + height - r);
					path.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
					path.lineTo(x + r, y + height);
					path.quadraticCurveTo(x, y + height, x, y + height - r);
					path.lineTo(x, y + r);
					path.quadraticCurveTo(x, y, x + r, y);
					path.closePath();
				}
			}
			out.push({
				path,
				strokeWidth: nextStrokeWidth,
				hasStroke: hasStroke(nextStrokeWidth, nextStrokeColor),
				hasFill: hasFill(nextFill)
			});
			break;
		}
		case "circle":
		case "ellipse": {
			const cx = parseNumber(element.getAttribute("cx"), 0);
			const cy = parseNumber(element.getAttribute("cy"), 0);
			const rx =
				tag === "circle"
					? parseNumber(element.getAttribute("r"), 0)
					: parseNumber(element.getAttribute("rx"), 0);
			const ry =
				tag === "circle"
					? rx
					: parseNumber(element.getAttribute("ry"), 0);
			if (rx <= 0 || ry <= 0) break;
			const rotation = tag === "ellipse"
				? parseNumber(element.getAttribute("rotation"), 0)
				: 0;
			const path = new Path2D();
			path.moveTo(cx + rx, cy);
			path.ellipse(cx, cy, rx, ry, rotation, 0, Math.PI * 2);
			out.push({
				path,
				strokeWidth: nextStrokeWidth,
				hasStroke: hasStroke(nextStrokeWidth, nextStrokeColor),
				hasFill: hasFill(nextFill)
			});
			break;
		}
	}
	for (let i = 0; i < element.children.length; i++) {
		collectPaths(element.children[i] as SVGElement, nextStrokeWidth, nextFill, nextStrokeColor, out);
	}
}

function parseSvg(svg: SVGElement): CachedIcon | null {
	const viewBox = parseViewBox(svg);
	const defaultStrokeWidth = parseNumber(svg.getAttribute("stroke-width"), 2);
	const defaultFill = svg.getAttribute("fill");
	const defaultStrokeColor = svg.getAttribute("stroke");
	const contentBounds = measureIconBounds(svg);
	const maxDimension = contentBounds
		? Math.max(contentBounds.width, contentBounds.height)
		: Math.max(viewBox.width, viewBox.height) || 24;
	const paths: IconPathSpec[] = [];
	for (let i = 0; i < svg.children.length; i++) {
		collectPaths(svg.children[i] as SVGElement, defaultStrokeWidth, defaultFill, defaultStrokeColor, paths);
	}
	return {
		viewBox,
		paths,
		contentBounds,
		maxDimension
	};
}

export class CanvasIconCache {
	private cache = new Map<string, CachedIcon | null>();

	public get(iconId: string): CachedIcon | null {
		if (this.cache.has(iconId)) {
			return this.cache.get(iconId) ?? null;
		}
		const svg = getIcon(iconId);
		if (!svg) {
			this.cache.set(iconId, null);
			return null;
		}
		const parsed = parseSvg(svg);
		this.cache.set(iconId, parsed);
		return parsed;
	}
}
