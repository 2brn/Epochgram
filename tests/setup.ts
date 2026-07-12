import { createRequire } from "node:module";

const g: any = globalThis as any;
const nodeRequire = createRequire(import.meta.url);

if (typeof g.window === "undefined") {
	g.window = g;
}

if (typeof g.self === "undefined") {
	g.self = g;
}

if (typeof g.require !== "function") {
	g.require = nodeRequire;
}

if (g.window && typeof g.window.require !== "function") {
	g.window.require = nodeRequire;
}
