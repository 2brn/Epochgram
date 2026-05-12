import { describe, expect, it } from "vitest";

import { splitPlusNPrefix } from "../src/ui/summary-rendering/plusn";

describe("splitPlusNPrefix", () => {
	it("splits a compact-mode '+N ' prefix", () => {
		expect(splitPlusNPrefix("+12 hello")).toEqual({ prefix: "+12", rest: "hello" });
		expect(splitPlusNPrefix("+1\tworld")).toEqual({ prefix: "+1", rest: "world" });
	});

	it("does not treat phone-number-like '+<many digits>' as a badge", () => {
		expect(splitPlusNPrefix("+3809350011 Some content")).toBe(null);
		expect(splitPlusNPrefix("+3809350011\nSome content")).toBe(null);
	});

	it("does not match when prefixed by whitespace", () => {
		expect(splitPlusNPrefix("  +12 hello")).toBe(null);
	});
});
