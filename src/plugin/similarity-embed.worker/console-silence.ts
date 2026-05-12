export {};

try {
	const c: any = console as any;
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
