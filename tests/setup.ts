const g: any = globalThis as any;

if (typeof g.window === "undefined") {
	g.window = g;
}

if (typeof g.self === "undefined") {
	g.self = g;
}
