import { describe, expect, it } from "vitest";
import { dropCachedInheritedMarkForPath } from "../src/ui/inherited-mark-cache";

describe("dropCachedInheritedMarkForPath", () => {
	it("removes only the requested path from inherited mark caches", () => {
		const plugin: any = {
			__epochInheritedMarkIndexByPath: new Map<string, number>([
				["A.md", 1],
				["B.md", 2]
			]),
			__epochInheritedMarkSourceByPath: new Map<string, string>([
				["A.md", "A.md"],
				["B.md", "A.md"]
			]),
			__epochInheritedMarkReasonByPath: new Map<string, string>([
				["A.md", ""],
				["B.md", "title"]
			])
		};

		dropCachedInheritedMarkForPath(plugin, "B.md");

		expect(plugin.__epochInheritedMarkIndexByPath.has("B.md")).toBe(false);
		expect(plugin.__epochInheritedMarkSourceByPath.has("B.md")).toBe(false);
		expect(plugin.__epochInheritedMarkReasonByPath.has("B.md")).toBe(false);

		// Does not touch other paths.
		expect(plugin.__epochInheritedMarkIndexByPath.get("A.md")).toBe(1);
		expect(plugin.__epochInheritedMarkSourceByPath.get("A.md")).toBe("A.md");
		expect(plugin.__epochInheritedMarkReasonByPath.get("A.md")).toBe("");
	});
});
