export {};

declare const self: {
	console?: {
		log?: (...args: unknown[]) => void;
		debug?: (...args: unknown[]) => void;
		info?: (...args: unknown[]) => void;
		warn?: (...args: unknown[]) => void;
		error?: (...args: unknown[]) => void;
	};
};

try {
	const c = self.console;
	if (c) {
		c.log = () => {};
		c.debug = () => {};
		c.info = () => {};
		c.warn = () => {};
		c.error = () => {};
	}
} catch {
	// ignore
}
