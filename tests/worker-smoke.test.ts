import { describe, expect, it } from "vitest";
import { pathToFileURL } from "node:url";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// This is a lightweight worker sanity test.
// It does NOT load transformers/onnxruntime (those depend on Obsidian/Electron
// worker quirks), but it verifies we can spin up an ESM module worker and
// exchange messages. This catches regressions in the environment where workers
// were accidentally spawned as classic workers (breaking `import.meta`).

describe("worker smoke", () => {
	it("can spawn a module worker and roundtrip messages", async () => {
		const dir = mkdtempSync(join(tmpdir(), "epoch-worker-test-"));
		const workerFile = join(dir, "worker.mjs");
		writeFileSync(
			workerFile,
			[
				"import { parentPort } from 'node:worker_threads';",
				"// ESM-only feature (breaks in classic workers)",
				"const u = import.meta.url;",
				"parentPort?.on('message', (msg) => {",
				"  if (msg?.type === 'ping') parentPort?.postMessage({ type: 'pong', url: u });",
				"});"
			].join("\n"),
			"utf8"
		);

		const { Worker } = await import("node:worker_threads");
		// Some @types/node versions don't include `WorkerOptions.type`, but Node supports it.
		const w = new Worker(pathToFileURL(workerFile), { type: "module" } as any);

		try {
			const pong = await new Promise<{ type: string; url?: string }>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error("timeout waiting for pong")), 5_000);
				w.on("message", (msg) => {
					clearTimeout(timeout);
					resolve(msg);
				});
				w.on("error", (err) => {
					clearTimeout(timeout);
					reject(err);
				});
				w.postMessage({ type: "ping" });
			});

			expect(pong.type).toBe("pong");
			expect(pong.url).toContain("worker.mjs");
		} finally {
			await w.terminate();
		}
	});
});
