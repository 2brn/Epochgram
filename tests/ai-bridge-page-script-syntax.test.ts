import { describe, expect, it } from "vitest";
import vm from "node:vm";

import { AI_BRIDGE_SCRIPT_PART1 } from "../src/plugin/ai-bridge-page/script-part-ui";
import { AI_BRIDGE_SCRIPT_PART2 } from "../src/plugin/ai-bridge-page/script-part-detect";
import { AI_BRIDGE_SCRIPT_PART3 } from "../src/plugin/ai-bridge-page/script-part-runner";

describe("AI bridge page scripts", () => {
	it("are valid JavaScript (parse-only)", () => {
		expect(() => {
			// Parse-only: validates syntax without executing.
			new vm.Script(`${AI_BRIDGE_SCRIPT_PART1}\n${AI_BRIDGE_SCRIPT_PART2}\n${AI_BRIDGE_SCRIPT_PART3}`);
		}).not.toThrow();
	});
});
