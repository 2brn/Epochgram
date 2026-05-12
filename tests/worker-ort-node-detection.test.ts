import { describe, expect, it } from "vitest";
import {
	detectNodeLikeEnvironment,
	maskNodeDetectionForBrowserLibraries,
	restoreNodeDetectionMask
} from "../src/plugin/worker-env";

describe("worker env masking", () => {
	it("masks Node detection by clearing process.versions.node", () => {
		const g: any = {
			process: {
				versions: { node: "20.0.0" },
				release: { name: "node" }
			}
		};
		expect(detectNodeLikeEnvironment(g)).toBe(true);

		const snap = maskNodeDetectionForBrowserLibraries(g);
		try {
			expect(detectNodeLikeEnvironment(g)).toBe(false);
		} finally {
			restoreNodeDetectionMask(g, snap);
		}

		expect(detectNodeLikeEnvironment(g)).toBe(true);
	});

	it("falls back to hiding global process if versions.node is non-writable", () => {
		const versions: any = {};
		Object.defineProperty(versions, "node", {
			value: "20.0.0",
			writable: false,
			configurable: true,
			enumerable: true
		});

		const g: any = {
			process: {
				versions,
				release: { name: "node" }
			}
		};
		expect(detectNodeLikeEnvironment(g)).toBe(true);

		const snap = maskNodeDetectionForBrowserLibraries(g);
		try {
			expect(detectNodeLikeEnvironment(g)).toBe(false);
		} finally {
			restoreNodeDetectionMask(g, snap);
		}

		expect(detectNodeLikeEnvironment(g)).toBe(true);
	});
});
